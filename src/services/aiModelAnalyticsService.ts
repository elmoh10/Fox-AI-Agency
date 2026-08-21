import { adminDb } from "./firebaseAdmin";

export type AiProvider =
  | "openrouter"
  | "gemini"
  | "unknown";

export type AiModelUsageStatus =
  | "success"
  | "failure";

export interface AiModelUsageInput {
  workspaceId?: string;
  provider: AiProvider;

  requestedModel?: string;
  servedModel?: string;

  agentRole?: string;
  channel?: string;

  toolsEnabled?: boolean;
  fallbackUsed?: boolean;

  status: AiModelUsageStatus;

  latencyMs?: number;

  errorType?: string;
  errorMessage?: string;
}

function safeModelKey(
  provider: string,
  model: string
) {
  return `${provider}_${model}`
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 500);
}

function makeUsageId() {
  return (
    "usage_" +
    Date.now() +
    "_" +
    Math.random()
      .toString(36)
      .slice(2, 10)
  );
}

class AiModelAnalyticsService {

  /**
   * Analytics MUST NEVER interrupt a customer reply.
   *
   * Therefore callers intentionally do not need
   * to await this method.
   */
  async recordUsage(
    input: AiModelUsageInput
  ): Promise<void> {
    try {
      const now =
        new Date().toISOString();

      const provider =
        input.provider || "unknown";

      const model =
        input.servedModel ||
        input.requestedModel ||
        "unknown";

      const eventId =
        makeUsageId();

      const event = {
        id: eventId,

        workspaceId:
          input.workspaceId || null,

        provider,

        requestedModel:
          input.requestedModel || null,

        servedModel:
          input.servedModel || null,

        model,

        agentRole:
          input.agentRole || null,

        channel:
          input.channel || null,

        toolsEnabled:
          input.toolsEnabled === true,

        fallbackUsed:
          input.fallbackUsed === true,

        status:
          input.status,

        latencyMs:
          typeof input.latencyMs === "number"
            ? input.latencyMs
            : null,

        errorType:
          input.errorType || null,

        errorMessage:
          input.errorMessage
            ? String(input.errorMessage)
                .slice(0, 1000)
            : null,

        createdAt: now,
      };

      await adminDb
        .collection("aiModelUsage")
        .doc(eventId)
        .set(event);

      await this.updateHealth(
        provider,
        model,
        event
      );

    } catch (error: any) {
      console.warn(
        "⚠️ [FOX AI Analytics] Logging failed safely:",
        error?.message || error
      );
    }
  }

  // =========================================================
  // FOX ADAPTIVE ROUTER V2
  //
  // Returns a proven free OpenRouter model only when enough
  // production evidence exists.
  //
  // Otherwise returns null and FOX safely uses openrouter/free.
  // =========================================================
  async getRecommendedOpenRouterModel(
    options: {
      toolsEnabled: boolean;
    }
  ): Promise<{
    model: string;
    score: number;
    requests: number;
    successRate: number;
    avgLatencyMs: number;
    reason: string;
  } | null> {
    try {
      const snapshot =
        await adminDb
          .collection("aiModelHealth")
          .get();

      const allModels =
        snapshot.docs.map((doc) => ({
          id: doc.id,
          ...(doc.data() as any),
        }));

      const candidates =
        allModels
          .filter((model: any) => {
            if (
              String(model.provider || "")
                .toLowerCase() !==
              "openrouter"
            ) {
              return false;
            }

            const modelName =
              String(model.model || "");

            // FOX Adaptive Router V2 is intentionally
            // FREE-MODEL ONLY.
            if (
              !modelName ||
              !modelName.endsWith(":free")
            ) {
              return false;
            }

            const requests =
              Number(model.requests || 0);

            const successRate =
              Number(
                model.successRate || 0
              );

            const health =
              String(
                model.healthStatus || ""
              ).toLowerCase();

            const recommendation =
              String(
                model.routingRecommendation ||
                "normal"
              ).toLowerCase();

            const cooldownUntil =
              model.cooldownUntil
                ? new Date(
                    model.cooldownUntil
                  ).getTime()
                : 0;

            const cooldownActive =
              cooldownUntil >
              Date.now();

            if (requests < 3) {
              return false;
            }

            // Real cooldown enforcement:
            // model is temporarily removed from adaptive
            // selection until cooldownUntil expires.
            if (cooldownActive) {
              return false;
            }

            if (
              health === "unhealthy"
            ) {
              return false;
            }

            // A stale "cooldown" recommendation without an
            // active timestamp must not permanently blacklist
            // the model. It may be tested again after expiry.

            // Never promote a model with poor reliability.
            if (successRate < 80) {
              return false;
            }

            if (options.toolsEnabled) {
              const toolRequests =
                Number(
                  model.toolRequests || 0
                );

              const toolSuccessRate =
                Number(
                  model.toolSuccessRate || 0
                );

              const toolRecommendation =
                String(
                  model.toolRecommendation ||
                  "normal"
                ).toLowerCase();

              // Tool routing requires actual evidence,
              // not merely general-chat success.
              if (toolRequests < 3) {
                return false;
              }

              if (
                toolSuccessRate < 80 ||
                toolRecommendation ===
                  "deprioritize"
              ) {
                return false;
              }
            }

            return true;
          })
          .map((model: any) => {
            const score =
              options.toolsEnabled
                ? Number(
                    model.adaptiveToolScore ||
                    0
                  )
                : Number(
                    model.adaptiveScore || 0
                  );

            return {
              model:
                String(model.model),

              score,

              requests:
                Number(
                  model.requests || 0
                ),

              successRate:
                Number(
                  model.successRate || 0
                ),

              avgLatencyMs:
                Number(
                  model.avgLatencyMs || 0
                ),

              preferred:
                String(
                  options.toolsEnabled
                    ? model.toolRecommendation
                    : model.routingRecommendation
                ).toLowerCase() ===
                "preferred",
            };
          });

      if (candidates.length === 0) {
        return null;
      }

      // Preferred recommendation wins first.
      //
      // Then:
      // 1. Adaptive score
      // 2. Success rate
      // 3. Lower latency
      // 4. More evidence / requests
      candidates.sort((a, b) => {
        if (
          a.preferred !== b.preferred
        ) {
          return a.preferred ? -1 : 1;
        }

        if (b.score !== a.score) {
          return b.score - a.score;
        }

        if (
          b.successRate !==
          a.successRate
        ) {
          return (
            b.successRate -
            a.successRate
          );
        }

        if (
          a.avgLatencyMs !==
          b.avgLatencyMs
        ) {
          return (
            a.avgLatencyMs -
            b.avgLatencyMs
          );
        }

        return (
          b.requests -
          a.requests
        );
      });

      const winner =
        candidates[0];

      return {
        model: winner.model,
        score: winner.score,
        requests: winner.requests,
        successRate:
          winner.successRate,
        avgLatencyMs:
          winner.avgLatencyMs,

        reason:
          options.toolsEnabled
            ? "best_proven_free_tool_model"
            : "best_proven_free_general_model",
      };

    } catch (error: any) {
      // Adaptive routing must NEVER block AI.
      console.warn(
        "⚠️ [FOX Adaptive Router] Model selection failed safely:",
        error?.message || error
      );

      return null;
    }
  }

  private async updateHealth(
    provider: string,
    model: string,
    event: any
  ) {
    const key =
      safeModelKey(
        provider,
        model
      );

    const ref =
      adminDb
        .collection("aiModelHealth")
        .doc(key);

    await adminDb.runTransaction(
      async (tx) => {
        const snap =
          await tx.get(ref);

        const old: any =
          snap.exists
            ? snap.data()
            : {};

        const requests =
          Number(
            old.requests || 0
          ) + 1;

        const successes =
          Number(
            old.successes || 0
          ) +
          (
            event.status === "success"
              ? 1
              : 0
          );

        const failures =
          Number(
            old.failures || 0
          ) +
          (
            event.status === "failure"
              ? 1
              : 0
          );

        const latencyCount =
          Number(
            old.latencyCount || 0
          ) +
          (
            typeof event.latencyMs === "number"
              ? 1
              : 0
          );

        const latencyTotalMs =
          Number(
            old.latencyTotalMs || 0
          ) +
          (
            typeof event.latencyMs === "number"
              ? event.latencyMs
              : 0
          );

        const avgLatencyMs =
          latencyCount > 0
            ? Math.round(
                latencyTotalMs /
                latencyCount
              )
            : 0;

        const successRate =
          requests > 0
            ? Number(
                (
                  successes /
                  requests *
                  100
                ).toFixed(2)
              )
            : 0;

        const toolRequests =
          Number(
            old.toolRequests || 0
          ) +
          (
            event.toolsEnabled
              ? 1
              : 0
          );

        const toolSuccesses =
          Number(
            old.toolSuccesses || 0
          ) +
          (
            event.toolsEnabled &&
            event.status === "success"
              ? 1
              : 0
          );

        const fallbackRequests =
          Number(
            old.fallbackRequests || 0
          ) +
          (
            event.fallbackUsed
              ? 1
              : 0
          );

        // ==================================================
        // FOX ADAPTIVE MODEL INTELLIGENCE
        // ==================================================

        const toolSuccessRate =
          toolRequests > 0
            ? Number(
                (
                  toolSuccesses /
                  toolRequests *
                  100
                ).toFixed(2)
              )
            : null;

        // Reliability carries the highest weight.
        const reliabilityScore =
          Math.max(
            0,
            Math.min(
              100,
              successRate
            )
          );

        // Latency scoring:
        // <= 3 sec   = excellent
        // <= 8 sec   = good
        // <= 15 sec  = acceptable
        // <= 30 sec  = slow
        // > 30 sec   = very slow
        let latencyScore = 100;

        if (avgLatencyMs > 30000) {
          latencyScore = 25;
        } else if (avgLatencyMs > 15000) {
          latencyScore = 50;
        } else if (avgLatencyMs > 8000) {
          latencyScore = 70;
        } else if (avgLatencyMs > 3000) {
          latencyScore = 85;
        }

        const toolScore =
          toolSuccessRate === null
            ? 70
            : toolSuccessRate;

        // General-purpose score.
        const adaptiveScore =
          Number(
            (
              reliabilityScore * 0.65 +
              latencyScore * 0.25 +
              toolScore * 0.10
            ).toFixed(2)
          );

        // Score specifically for operational/tool requests.
        const adaptiveToolScore =
          Number(
            (
              reliabilityScore * 0.45 +
              toolScore * 0.40 +
              latencyScore * 0.15
            ).toFixed(2)
          );

        let healthStatus =
          "healthy";

        if (
          requests >= 3 &&
          successRate < 50
        ) {
          healthStatus =
            "unhealthy";
        } else if (
          requests >= 3 &&
          successRate < 80
        ) {
          healthStatus =
            "degraded";
        }

        // Recommendation consumed later by Adaptive Router V2.
        let routingRecommendation:
          | "preferred"
          | "normal"
          | "deprioritize"
          | "cooldown" =
          "normal";

        if (
          requests >= 3 &&
          (
            successRate < 50 ||
            adaptiveScore < 45
          )
        ) {
          routingRecommendation =
            "cooldown";
        } else if (
          requests >= 3 &&
          (
            successRate < 80 ||
            adaptiveScore < 65
          )
        ) {
          routingRecommendation =
            "deprioritize";
        } else if (
          requests >= 3 &&
          adaptiveScore >= 85
        ) {
          routingRecommendation =
            "preferred";
        }

        // Tool-specific recommendation.
        let toolRecommendation:
          | "preferred"
          | "normal"
          | "deprioritize" =
          "normal";

        if (
          toolRequests >= 3 &&
          adaptiveToolScore >= 85
        ) {
          toolRecommendation =
            "preferred";
        } else if (
          toolRequests >= 3 &&
          adaptiveToolScore < 65
        ) {
          toolRecommendation =
            "deprioritize";
        }

        // ==================================================
        // FOX MODEL COOLDOWN ENFORCEMENT V1
        // ==================================================
        //
        // A model is temporarily removed from Adaptive Router
        // selection when enough real evidence shows instability.
        //
        // Default cooldown = 30 minutes.
        // After expiry the model becomes eligible again.
        // ==================================================

        const previousCooldownUntil =
          old.cooldownUntil
            ? String(old.cooldownUntil)
            : null;

        let cooldownUntil =
          previousCooldownUntil;

        let cooldownReason =
          old.cooldownReason || null;

        if (
          routingRecommendation ===
          "cooldown"
        ) {
          cooldownUntil =
            new Date(
              Date.now() +
              30 * 60 * 1000
            ).toISOString();

          cooldownReason =
            successRate < 50
              ? "low_success_rate"
              : "low_adaptive_score";
        } else if (
          cooldownUntil &&
          new Date(
            cooldownUntil
          ).getTime() <= Date.now()
        ) {
          // Expired cooldown is cleared automatically.
          cooldownUntil = null;
          cooldownReason = null;
        }

        tx.set(
          ref,
          {
            id: key,

            provider,
            model,

            requests,
            successes,
            failures,

            successRate,

            latencyCount,
            latencyTotalMs,
            avgLatencyMs,

            toolRequests,
            toolSuccesses,
            toolSuccessRate,

            fallbackRequests,

            // FOX Adaptive Intelligence
            reliabilityScore,
            latencyScore,
            toolScore,
            adaptiveScore,
            adaptiveToolScore,

            routingRecommendation,
            toolRecommendation,

            cooldownUntil,
            cooldownReason,

            healthStatus,

            lastStatus:
              event.status,

            lastError:
              event.errorMessage || null,

            lastWorkspaceId:
              event.workspaceId || null,

            lastAgentRole:
              event.agentRole || null,

            lastChannel:
              event.channel || null,

            lastUsedAt:
              event.createdAt,

            updatedAt:
              event.createdAt,

            createdAt:
              old.createdAt ||
              event.createdAt,
          },
          {
            merge: true
          }
        );
      }
    );
  }
}

export const aiModelAnalyticsService =
  new AiModelAnalyticsService();

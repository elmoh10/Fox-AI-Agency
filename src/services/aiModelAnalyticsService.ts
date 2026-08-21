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

            fallbackRequests,

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

import { adminDb } from "./firebaseAdmin";

export type CrmChannel =
  | "telegram"
  | "whatsapp"
  | "instagram"
  | "web"
  | string;

export interface WorkspaceCrmCustomerInput {
  channel: CrmChannel;
  externalCustomerId: string;
  name?: string;
  phone?: string;
  email?: string;
  sessionId?: string;
  conversationId?: string;
}

function clean(value: any): string {
  return String(value ?? "").trim();
}

function normalizePhone(value: string): string {
  return clean(value).replace(/[^\d+]/g, "");
}

function buildLeadId(
  channel: string,
  externalCustomerId: string
): string {
  const safeChannel =
    clean(channel).toLowerCase() || "unknown";

  const safeCustomer =
    clean(externalCustomerId)
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 120);

  return `${safeChannel}_${safeCustomer}`;
}

export const workspaceCrmService = {
  async upsertChannelCustomer(
    workspaceId: string,
    input: WorkspaceCrmCustomerInput
  ) {
    const cleanWorkspaceId = clean(workspaceId);
    const channel = clean(input.channel).toLowerCase();
    const externalCustomerId = clean(
      input.externalCustomerId
    );

    if (!cleanWorkspaceId) {
      throw new Error("workspaceId is required");
    }

    if (!channel) {
      throw new Error("CRM channel is required");
    }

    if (!externalCustomerId) {
      throw new Error(
        "CRM externalCustomerId is required"
      );
    }

    const leadId = buildLeadId(
      channel,
      externalCustomerId
    );

    const leadRef = adminDb
      .collection("workspaces")
      .doc(cleanWorkspaceId)
      .collection("crmLeads")
      .doc(leadId);

    const snapshot = await leadRef.get();

    const now = new Date().toISOString();

    const name =
      clean(input.name) ||
      (channel === "telegram"
        ? "Telegram Customer"
        : channel === "whatsapp"
        ? "WhatsApp Customer"
        : "Customer");

    const phone = normalizePhone(
      input.phone || ""
    );

    if (snapshot.exists) {
      const existing: any =
        snapshot.data() || {};

      const updates: any = {
        workspaceId: cleanWorkspaceId,
        channel,
        externalCustomerId,
        lastInteraction: now,
        updatedAt: now,
      };

      if (
        name &&
        (
          !existing.name ||
          existing.name === "Telegram Customer" ||
          existing.name === "WhatsApp Customer" ||
          existing.name === "Customer"
        )
      ) {
        updates.name = name;
      }

      if (phone && !existing.phone) {
        updates.phone = phone;
        updates.phoneNormalized = phone;
      }

      if (
        clean(input.email) &&
        !existing.email
      ) {
        updates.email = clean(input.email);
      }

      if (clean(input.sessionId)) {
        updates.sessionId =
          clean(input.sessionId);
      }

      if (clean(input.conversationId)) {
        updates.conversationId =
          clean(input.conversationId);
      }

      await leadRef.set(
        updates,
        { merge: true }
      );

      const updated =
        await leadRef.get();

      return {
        created: false,
        lead: {
          id: leadId,
          ...(updated.data() || {}),
        },
      };
    }

    const lead = {
      id: leadId,
      workspaceId: cleanWorkspaceId,

      name,
      phone,
      email: clean(input.email),

      channel,
      externalCustomerId,

      sessionId:
        clean(input.sessionId) || null,

      conversationId:
        clean(input.conversationId) || null,

      status: "Lead",

      tags: [
        "ai_agent",
        channel,
      ],

      notes: "",

      totalSpentEGP: 0,

      source: "ai_agent",

      createdAt: now,
      updatedAt: now,
      lastInteraction: now,
    };

    await leadRef.set(lead);

    console.log(
      `👤 [FOX CRM] New customer | Workspace=${cleanWorkspaceId} | Lead=${leadId} | Channel=${channel}`
    );

    return {
      created: true,
      lead,
    };
  },

  async getLead(
    workspaceId: string,
    leadId: string
  ) {
    const snapshot = await adminDb
      .collection("workspaces")
      .doc(clean(workspaceId))
      .collection("crmLeads")
      .doc(clean(leadId))
      .get();

    if (!snapshot.exists) {
      return null;
    }

    return {
      id: snapshot.id,
      ...snapshot.data(),
    };
  },

  async listLeads(
    workspaceId: string
  ) {
    const snapshot = await adminDb
      .collection("workspaces")
      .doc(clean(workspaceId))
      .collection("crmLeads")
      .orderBy("lastInteraction", "desc")
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
  },

  async updateLeadStatus(
    workspaceId: string,
    leadId: string,
    status: "Lead" | "Prospect" | "Customer"
  ) {
    const ref = adminDb
      .collection("workspaces")
      .doc(clean(workspaceId))
      .collection("crmLeads")
      .doc(clean(leadId));

    const snapshot = await ref.get();

    if (!snapshot.exists) {
      throw new Error("CRM lead not found");
    }

    await ref.set(
      {
        status,
        updatedAt:
          new Date().toISOString(),
      },
      { merge: true }
    );

    return {
      success: true,
      status,
    };
  },
};

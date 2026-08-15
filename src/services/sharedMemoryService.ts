import { db } from "./firebase";
import { doc, getDoc, setDoc, updateDoc, arrayUnion } from "firebase/firestore";

export interface ConversationMessage {
  sender: "user" | "bot";
  text: string;
  time: string;
  agentRole?: "Support" | "Sales" | "Marketing" | "Router" | "Unknown";
}

export interface SharedMemoryContext {
  workspaceId: string;
  sessionId: string; // e.g. customer phone or telegram chatId
  messages: ConversationMessage[];
  lastUpdatedAt: string;
  assignedAgent?: "Support" | "Sales" | "Marketing" | "Router" | "Unknown";
}

export class SharedMemoryService {
  /**
   * Fetch the shared conversation context for a given workspace and session (customer)
   */
  async getContext(workspaceId: string, sessionId: string): Promise<SharedMemoryContext> {
    try {
      const docRef = doc(db, "workspaces", workspaceId, "shared_memory", sessionId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        return snap.data() as SharedMemoryContext;
      }
      return {
        workspaceId,
        sessionId,
        messages: [],
        lastUpdatedAt: new Date().toISOString(),
      };
    } catch (err) {
      console.warn("SharedMemoryService: Could not fetch context, returning empty.", err);
      return { workspaceId, sessionId, messages: [], lastUpdatedAt: new Date().toISOString() };
    }
  }

  /**
   * Append a new message to the shared conversation context
   */
  async appendMessage(workspaceId: string, sessionId: string, message: ConversationMessage): Promise<void> {
    try {
      const docRef = doc(db, "workspaces", workspaceId, "shared_memory", sessionId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        await updateDoc(docRef, {
          messages: arrayUnion(message),
          lastUpdatedAt: new Date().toISOString(),
          assignedAgent: message.agentRole || snap.data().assignedAgent,
        });
      } else {
        const newCtx: SharedMemoryContext = {
          workspaceId,
          sessionId,
          messages: [message],
          lastUpdatedAt: new Date().toISOString(),
          assignedAgent: message.agentRole,
        };
        await setDoc(docRef, newCtx);
      }
    } catch (err) {
      console.error("SharedMemoryService: Failed to append message.", err);
    }
  }

  /**
   * Clear or reset context
   */
  async resetContext(workspaceId: string, sessionId: string): Promise<void> {
    try {
      const docRef = doc(db, "workspaces", workspaceId, "shared_memory", sessionId);
      await setDoc(docRef, {
        workspaceId,
        sessionId,
        messages: [],
        lastUpdatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error("SharedMemoryService: Failed to reset context.", err);
    }
  }
}

export const sharedMemoryService = new SharedMemoryService();

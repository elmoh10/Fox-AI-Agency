import { GoogleGenAI, Type } from "@google/genai";
import OpenAI from "openai";
import { checkAvailability, bookAppointmentInSheet } from "./googleSheetsService";
import { workspaceDataService } from "./workspaceDataService";
import { triggerExternalCRM } from "./crmService";
import { sharedMemoryService } from "./sharedMemoryService";

export interface AiAgentConfig {
  agentName?: string;
  customPrompt?: string;
  tone?: "Friendly" | "Professional" | "Empathetic" | "Formal" | "Direct";
  languageMode?: "auto" | "arabic" | "english";
  autoBookingEnabled?: boolean;
  autoComplaintEscalation?: boolean;
  strictCatalogOnly?: boolean;
  currency?: string;
  fallbackMessage?: string;
  workingHours?: string;
  supportAgentName?: string;
  supportAgentPrompt?: string;
  salesAgentName?: string;
  salesAgentPrompt?: string;
  marketingAgentName?: string;
  marketingAgentPrompt?: string;
  routerPrompt?: string;
  salesKeywords?: string;
  supportKeywords?: string;
  marketingKeywords?: string;
  enableServiceRating?: boolean;
  serviceRatingPrompt?: string;
}

export interface WorkspaceContext {
  id?: string;
  name?: string;
  industry?: string;
  creditBalance?: number;
  aiSettings?: AiAgentConfig;
  knowledgeBase?: { question: string; answer: string; approved?: boolean }[];
  doctors?: { name: string; specialty: string; slots?: string[]; consultationFeeEGP?: number }[];
  menu?: { name: string; category: string; price: number; description?: string; available?: boolean; alternativeItemName?: string; alternativeNotes?: string }[];
  medicines?: { name: string; category: string; price: number; requiresPrescription?: boolean; available?: boolean; alternativeItemName?: string; alternativeNotes?: string }[];
  courses?: { name: string; price: number; duration: string; description?: string; instructor?: string }[];
  courseReviews?: { studentName: string; courseName: string; rating: number; comment: string; reply?: string }[];
  products?: { name: string; price: number; stock?: number; available?: boolean; alternativeItemName?: string; alternativeNotes?: string }[];
  clinicServices?: { name: string; price: number; durationMinutes: number; description?: string; available?: boolean }[];
  googleSheetsAccessToken?: string;
  crmSpreadsheetId?: string;
  externalCrmWebhookUrl?: string;
}

export interface GenerateChatParams {
  workspace?: WorkspaceContext;
  message: string;
  channel?: string;
  chatHistory?: { role?: string; sender?: string; text?: string; parts?: any[] }[];
  sessionId?: string;
  overrideConfig?: Partial<AiAgentConfig>;
}

export interface ChatResponse {
  response: string;
  aiResponse: string;
  detectedLanguage: "ar" | "en";
  source: string;
  suggestedActions: string[];
}

export class AiAgentService {

  // =========================================================
  // OPENROUTER CLIENT
  // Primary AI provider for FOX AI AGENCY
  // Uses OpenAI-compatible API.
  // =========================================================
  private getOpenRouterClient(): OpenAI | null {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) return null;

    return new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://fox-ai-agency.ai.studio/",
        "X-Title": "FOX AI AGENCY",
      },
    });
  }

  private getGeminiClient(): GoogleGenAI | null {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: { "User-Agent": "aistudio-build" },
      },
    });
  }

  public detectLanguage(text: string): "ar" | "en" {
    return /[\u0600-\u06FF]/.test(text) ? "ar" : "en";
  }


  private parseRouterKeywords(raw: string | undefined, defaults: string[]): string[] {
    if (!raw?.trim()) return defaults;

    return raw
      .split(/[,،\n]/)
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
  }

  private async detectAgentRole(
    workspace: WorkspaceContext = {},
    message: string
  ): Promise<"Sales" | "Support" | "Marketing"> {

    const lower = message.toLowerCase();

    // Appointment / availability questions are Sales unless
    // the customer is reporting a problem with an existing booking.
    const hasAppointmentLanguage =
      /(موعد|مواعيد|كشف|حجز|appointment|appointments|availability|available)/i.test(lower);

    const hasExistingBookingProblem =
      /(اتلغ|إلغاء|الغاء|مشكلة|تأخير|متأخر|شكوى|refund|cancel|complaint|problem|issue)/i.test(lower);

    if (hasAppointmentLanguage && !hasExistingBookingProblem) {
      return "Sales";
    }

    const salesKeywords = this.parseRouterKeywords(
      workspace.aiSettings?.salesKeywords,
      [
        "سعر", "اسعار", "أسعار", "بكام",
        "شراء", "اشتراك", "باقة", "باقات",
        "حجز", "احجز", "طلب", "اطلب",
        "price", "pricing", "buy", "book",
        "order", "subscribe"
      ]
    );

    const supportKeywords = this.parseRouterKeywords(
      workspace.aiSettings?.supportKeywords,
      [
        "شكوى", "مشكلة", "مش شغال", "لا يعمل",
        "عطل", "مساعدة", "الغاء", "إلغاء",
        "اتلغى", "تأخير", "متأخر", "استرجاع",
        "complaint", "issue", "problem", "help",
        "cancel", "refund", "support"
      ]
    );

    const marketingKeywords = this.parseRouterKeywords(
      workspace.aiSettings?.marketingKeywords,
      [
        "عرض", "عروض", "خصم", "خصومات",
        "كوبون", "برومو", "جديد", "ترشيح",
        "اقتراح", "offer", "offers", "discount",
        "promo", "coupon", "recommend"
      ]
    );

    const score = (keywords: string[]) =>
      keywords.reduce(
        (total, keyword) => total + (lower.includes(keyword) ? 1 : 0),
        0
      );

    const scores = {
      Sales: score(salesKeywords),
      Support: score(supportKeywords),
      Marketing: score(marketingKeywords),
    };

    const highestScore = Math.max(
      scores.Sales,
      scores.Support,
      scores.Marketing
    );

    const winners = (
      Object.entries(scores) as Array<
        ["Sales" | "Support" | "Marketing", number]
      >
    ).filter(([, value]) => value === highestScore && value > 0);

    // Clear keyword winner
    if (winners.length === 1) {
      return winners[0][0];
    }

    // Ambiguous message -> AI Router
    const routerPrompt = `
You are the hidden Smart Agent Router for FOX AI AGENCY.

Classify the customer's message into EXACTLY ONE category.

SALES:
Pricing, purchasing, subscriptions, NEW bookings,
appointment availability, placing orders, or purchase intent.

SUPPORT:
Complaints, problems with an EXISTING booking/order,
refunds, cancellations, technical issues or dissatisfaction.

MARKETING:
Offers, discounts, promotions, recommendations,
upselling or discovering new services.

RULES:
- NEW booking = SALES
- Asking about available appointments = SALES
- Problem with EXISTING booking = SUPPORT
- Offers or discounts = MARKETING
- Output ONE WORD ONLY:
SALES, SUPPORT, or MARKETING

CUSTOM ROUTER INSTRUCTIONS:
${workspace.aiSettings?.routerPrompt || "None"}

CUSTOMER MESSAGE:
${message}
`;

    // OpenRouter is the primary router.
    const openRouter = this.getOpenRouterClient();

    if (openRouter) {
      try {
        const result = await openRouter.chat.completions.create({
          model: process.env.OPENROUTER_MODEL || "openrouter/free",
          messages: [
            {
              role: "system",
              content:
                "You are a hidden intent classifier. Output only SALES, SUPPORT, or MARKETING."
            },
            {
              role: "user",
              content: routerPrompt
            }
          ],
          temperature: 0
        });

        const routed =
          String(result.choices?.[0]?.message?.content || "")
            .trim()
            .toUpperCase();

        if (routed.includes("MARKETING")) return "Marketing";
        if (routed.includes("SUPPORT")) return "Support";
        if (routed.includes("SALES")) return "Sales";

      } catch (err) {
        console.warn(
          "Smart Router OpenRouter classification failed:",
          err
        );
      }
    }

    // Gemini is only the secondary router fallback.
    const ai = this.getGeminiClient();

    if (ai) {
      try {
        const result = await ai.models.generateContent({
          model: "gemini-3.6-flash",
          contents: routerPrompt,
          config: { temperature: 0 },
        });

        const routed = (result.text || "")
          .trim()
          .toUpperCase();

        if (routed.includes("MARKETING")) return "Marketing";
        if (routed.includes("SUPPORT")) return "Support";
        if (routed.includes("SALES")) return "Sales";

      } catch (err) {
        console.warn(
          "Smart Router Gemini fallback failed:",
          err
        );
      }
    }

    return "Support";
  }

  public buildSystemInstruction(
    workspace: WorkspaceContext = {},
    messageLang: "ar" | "en",
    channel: string = "TELEGRAM",
    overrideConfig?: Partial<AiAgentConfig>
  ): string {
    const config: AiAgentConfig = {
      agentName: workspace.aiSettings?.agentName || `${workspace.name || "Business"} AI Assistant`,
      customPrompt: workspace.aiSettings?.customPrompt || "",
      tone: workspace.aiSettings?.tone || "Friendly",
      languageMode: workspace.aiSettings?.languageMode || "auto",
      autoBookingEnabled: workspace.aiSettings?.autoBookingEnabled ?? true,
      autoComplaintEscalation: workspace.aiSettings?.autoComplaintEscalation ?? true,
      strictCatalogOnly: true,
      currency: "EGP",
      supportAgentName: workspace.aiSettings?.supportAgentName,
      supportAgentPrompt: workspace.aiSettings?.supportAgentPrompt,
      salesAgentName: workspace.aiSettings?.salesAgentName,
      salesAgentPrompt: workspace.aiSettings?.salesAgentPrompt,
      marketingAgentName: workspace.aiSettings?.marketingAgentName,
      marketingAgentPrompt: workspace.aiSettings?.marketingAgentPrompt,
      routerPrompt: workspace.aiSettings?.routerPrompt,
      salesKeywords: workspace.aiSettings?.salesKeywords,
      supportKeywords: workspace.aiSettings?.supportKeywords,
      marketingKeywords: workspace.aiSettings?.marketingKeywords,
      ...overrideConfig,
    };

    const businessName = workspace.name || "Fox Business";
    const industry = workspace.industry || "Small Business";

    let industryContext = "";
    if (workspace.aiSettings?.workingHours) {
      industryContext += `WORKING HOURS: ${workspace.aiSettings.workingHours}\n\n`;
    }
    if (industry === "Clinic") {
      if (workspace.doctors) {
        industryContext +=
          "DOCTORS & CLINIC SLOTS:\n" +
          workspace.doctors
            .map(
              (d) =>
                `- Dr. ${d.name} (${d.specialty}): Fee: ${d.consultationFeeEGP || 0} EGP, Available slots: ${
                  d.slots?.join(", ") || "10:00 AM, 02:00 PM, 06:00 PM"
                }`
            )
            .join("\n") + "\n\n";
      }
      if (workspace.clinicServices) {
        industryContext +=
          "CLINIC SERVICES & PRICING:\n" +
          workspace.clinicServices
            .map((s) => `- ${s.name}: ${s.price} EGP (${s.durationMinutes} mins) ${s.description || ""}`)
            .join("\n") + "\n\n";
      }
    } else if (industry === "Restaurant" && workspace.menu) {
      industryContext +=
        "RESTAURANT MENU & PRICES:\n" +
        workspace.menu
          .map(
            (m) =>
              `- ${m.name} (${m.category}): ${m.price} ${config.currency} - ${m.description || ""} ${
                m.available !== false ? "[Available / متاح]" : "[OUT OF STOCK / غير متاح]"
              } ${m.alternativeItemName ? `(Suggested Alternative: ${m.alternativeItemName} - ${m.alternativeNotes || ''})` : ''}`
          )
          .join("\n");
    } else if (industry === "Pharmacy" && workspace.medicines) {
      industryContext +=
        "PHARMACY MEDICINES & ALTERNATIVES:\n" +
        workspace.medicines
          .map(
            (m) =>
              `- ${m.name}: ${m.price} ${config.currency} (${m.category}) - ${
                m.requiresPrescription ? "Requires Prescription" : "Over the counter"
              }. Status: ${m.available !== false ? "[Available / متاح]" : "[OUT OF STOCK / غير متاح]"}. ${
                m.alternativeItemName ? `[RECOMMENDED ALTERNATIVE MEDICINE: ${m.alternativeItemName} (${m.alternativeNotes || ''})]` : ''
              }`
          )
          .join("\n");
    } else if (industry === "Retail" && workspace.products) {
      industryContext +=
        "STORE PRODUCTS, STOCK & ALTERNATIVES:\n" +
        workspace.products
          .map((p) => `- ${p.name}: ${p.price} ${config.currency} - Status: ${p.available !== false ? "[Available / متاح]" : "[OUT OF STOCK / غير متاح]"} (Stock: ${p.stock || 0}). ${
            p.alternativeItemName ? `[RECOMMENDED ALTERNATIVE PRODUCT: ${p.alternativeItemName} (${p.alternativeNotes || ''})]` : ''
          }`)
          .join("\n");
    } else if (industry === "Course Center" && workspace.courses) {
      industryContext +=
        "AVAILABLE TRAINING COURSES:\n" +
        workspace.courses
          .map((c) => `- ${c.name}: ${c.price} ${config.currency} (Duration: ${c.duration}, Instructor: ${c.instructor || 'TBD'}) - ${c.description || ''}`)
          .join("\n");
    }

    let reviewsContext = "";
    if (industry === "Course Center" && workspace.courseReviews) {
      reviewsContext = "\n\nSTUDENT REVIEWS (Use these to build trust and show social proof if asked about quality):\n" +
        workspace.courseReviews
          .map((r) => `- ${r.studentName} rated ${r.courseName} ${r.rating}/5: "${r.comment}" ${r.reply ? `(Center Reply: ${r.reply})` : ''}`)
          .join("\n");
    }

    const approvedKnowledge = (workspace.knowledgeBase || [])
      .filter((k) => k.approved !== false)
      .map((k) => `Q: ${k.question}\nA: ${k.answer}`)
      .join("\n\n");

    let toneGuide = "";
    switch (config.tone) {
      case "Friendly":
        toneGuide =
          "Warm, welcoming, polite, and accessible (use cheerful, friendly Egyptian Arabic dialect or polite English).";
        break;
      case "Professional":
        toneGuide = "Formal, respectful, objective, and structured business tone.";
        break;
      case "Empathetic":
        toneGuide =
          "Extremely attentive, compassionate, patient (especially suitable for clinic or pharmacy customers).";
        break;
      case "Formal":
        toneGuide = "High-level corporate, polite, strict standard language.";
        break;
      case "Direct":
        toneGuide = "Concise, straight-to-the-point without fluff or long greetings.";
        break;
      default:
        toneGuide = "Polite and helpful customer support tone.";
    }

    let targetLanguage = messageLang;
    if (config.languageMode === "arabic") targetLanguage = "ar";
    if (config.languageMode === "english") targetLanguage = "en";

    const isTargetAr = targetLanguage === "ar";

    return `
You are "${config.agentName}", an expert AI Customer Support Agent representing "${businessName}" (${industry}) on ${channel.toUpperCase()}.

TARGET LANGUAGE MANDATE:
You MUST reply strictly in ${
      isTargetAr
        ? "ARABIC (العامية المصرية البسيطة الواضحة والمهذبة أو الفصحى البسيطة)"
        : "ENGLISH"
    }.
Do NOT switch languages unless explicitly requested by the customer.

TONE OF VOICE & STYLE:
${toneGuide}

BEHAVIORAL CONSTRAINTS & CORE RULES:
1. ACCURACY & ZERO HALLUCINATION: Rely STRICTLY on the approved knowledge base and catalog provided below. NEVER invent prices, doctors, medicines, or services.
2. CURRENCY: All prices must be quoted in ${config.currency} (Egyptian Pounds / جنيه مصري) unless specified otherwise.
3. DATA CAPTURE (CRM): ${
      config.autoBookingEnabled
        ? "When a customer wants to book an appointment, order an item, or reschedule, politely ask for their Full Name, Phone Number, and Preferred Date/Time, and confirm that their request will be saved in the CRM."
        : "Inform customers about available slots/prices and ask them to contact staff directly for final bookings."
    }
4. ESCALATION & COMPLAINTS & REVIEWS: ${
      config.autoComplaintEscalation
        ? "If a customer expresses dissatisfaction or files a complaint, express sincere empathy, record their issue details, and assure them a senior manager will contact them shortly. If a customer leaves a positive review, thank them gracefully."
        : "Direct customer complaints to our official support line. Thank customers for any positive reviews."
    }
5. OUT-OF-SCOPE INQUIRIES: If asked about something not present in the business context, state politely that you don't have that information right now and offer to connect them with a human team member.
6. PRODUCT & MEDICINE AVAILABILITY & ORDER VERIFICATION:
   - When a customer requests a medicine, product, or order item that is marked as [OUT OF STOCK / غير متاح]:
     a) State clearly that the requested item is currently unavailable in our main inventory.
     b) If an alternative medicine or product is provided in the catalog, proactively suggest it: "ولكن يتوفر لدينا الدواء/المنتج البديل: [Alternative Name] - [Alternative Notes]".
     c) Inform the customer: "وقد تم رفع طلب أوردر لصاحب المنشأة للتأكد التام من توفر المنتج بالمخزن الرئيسي وإفادتكم فوراً." (An order request has been logged for the owner to double-check inventory).
   - When a customer places an order for available items, confirm the items and price, and inform them that an order verification alert has been sent to the facility owner.
7. SERVICE RATING PROMPT:
   ${
     config.enableServiceRating !== false
       ? `At the end of your response when completing a booking, order, or providing requested information, politely ask the customer for their service rating: "${config.serviceRatingPrompt || "نرجو تقييم خدمتنا اليوم من 1 إلى 5 نجوم لمساعدتنا في تحسين تجربتك"}"`
       : "Do not ask for service ratings unless the user specifically asks to evaluate the service."
   }

CUSTOM CLIENT INSTRUCTIONS:
${config.customPrompt || "No custom instructions defined."}

APPROVED KNOWLEDGE BASE (FAQS):
${approvedKnowledge || "No custom FAQ entries available."}

BUSINESS CATALOG & DATA:
${industryContext || "Standard business inquiry catalog."}
`;
  }


  public async extractKnowledge(input: { type: 'url' | 'text' | 'file'; content?: string; url?: string; mimeType?: string }): Promise<{ question: string; answer: string }[]> {
    const ai = this.getGeminiClient();
    if (!ai) throw new Error("Gemini API key not configured");

    let prompt = "Extract key information from the following content and generate a list of Frequently Asked Questions (FAQs) in a strict JSON array format. Each object must have exactly two keys: 'question' and 'answer'. Both should be strings. Focus on business details, pricing, services, policies, and contact info.\n\n";
    let parts = [];

    if (input.type === 'url' && input.url) {
      // Very basic URL extraction, ideally we'd fetch the HTML and convert to text, or use Gemini's built-in search grounding. 
      // For now, let's just ask Gemini to analyze the URL directly (some models can browse or we can just fetch the content here).
      // Since we are in a Node environment, let's fetch the URL content text.
      try {
        const response = await fetch(input.url);
        const text = await response.text();
        // Take first 50000 characters to avoid exceeding token limits if it's huge
        const cleanText = text.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').substring(0, 50000);
        prompt += `Content from ${input.url}:\n\n${cleanText}`;
        parts = [{ text: prompt }];
      } catch (e) {
        throw new Error("Failed to fetch content from URL: " + e.message);
      }
    } else if (input.type === 'text' && input.content) {
      prompt += input.content;
      parts = [{ text: prompt }];
    } else if (input.type === 'file' && input.content && input.mimeType) {
      parts = [
        { text: prompt },
        {
          inlineData: {
            data: input.content,
            mimeType: input.mimeType
          }
        }
      ];
    } else {
      throw new Error("Invalid input for knowledge extraction");
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: [{ role: "user", parts }],
      config: {
        responseMimeType: "application/json",
        systemInstruction: "You are an expert data extractor. You must respond ONLY with a valid JSON array of objects, each containing 'question' and 'answer' string properties. Do not include markdown formatting or any other text.",
        temperature: 0.1
      }
    });

    const text = response.text;
    if (!text) return [];
    
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
         return parsed.map(item => ({
           question: item.question || item.Question || "",
           answer: item.answer || item.Answer || ""
         })).filter(item => item.question && item.answer);
      }
      return [];
    } catch (e) {
      console.error("Failed to parse knowledge extraction JSON", e, text);
      return [];
    }
  }

  public async generateChatResponse(params: GenerateChatParams): Promise<ChatResponse> {
    const { workspace } = params;
    
    // Check if credit is exhausted
    if (workspace && typeof workspace.creditBalance === 'number' && workspace.creditBalance <= 0) {
      return {
        response: workspace.aiSettings?.languageMode === 'english' 
          ? "Service temporarily unavailable (Credit Exhausted). Please contact the business."
          : "الخدمة غير متاحة حالياً (نفاذ الرصيد). يرجى التواصل مع النشاط التجاري.",
        aiResponse: workspace.aiSettings?.languageMode === 'english' ? "Service temporarily unavailable" : "الخدمة غير متاحة حالياً",
        detectedLanguage: workspace.aiSettings?.languageMode === 'english' ? "en" : "ar",
        source: "system",
        suggestedActions: []
      };
    }

    const { message, channel = "telegram", chatHistory = [], overrideConfig } = params;
    

    let messageLang = this.detectLanguage(message);

    // Phone numbers / numeric-only replies have no language.
    // Recover the language from recent conversation context.
    if (!/[A-Za-z\u0600-\u06FF]/.test(message) && workspace?.id && params.sessionId) {
      try {
        const languageCtx = await sharedMemoryService.getContext(
          workspace.id,
          params.sessionId
        );

        const previousText = languageCtx.messages
          .slice()
          .reverse()
          .map((m) => m.text || "")
          .find((text) => /[A-Za-z\u0600-\u06FF]/.test(text));

        if (previousText) {
          messageLang = this.detectLanguage(previousText);
        }
      } catch {
        // Keep original detection as fallback.
      }
    }

    // =========================================================
    // DETERMINISTIC APPOINTMENT CANCELLATION
    // Cancellation is a CRM transaction, not an LLM decision.
    // =========================================================
    if (workspace?.id && params.sessionId) {
      const cancelCtx =
        await sharedMemoryService.getContext(
          workspace.id,
          params.sessionId
        );

      const cancelMessage = String(message || "").trim();
      const cancelLower = cancelMessage.toLowerCase();

      const cancelIntent =
        /(ألغي\s*(حجزي|الحجز|موعدي)|الغي\s*(حجزي|الحجز|موعدي)|إلغاء\s*(حجز|موعد)|الغاء\s*(حجز|موعد)|cancel\s*(my\s*)?(booking|appointment))/i.test(
          cancelLower
        );

      const lastBot =
        cancelCtx.messages
          .slice()
          .reverse()
          .find((m) => m.sender === "bot")
          ?.text || "";

      const digitsOnly =
        cancelMessage.replace(/\D/g, "");

      const isPhone =
        digitsOnly.length >= 10 &&
        digitsOnly.length <= 15;

      const waitingForCancelPhone =
        /(رقم الموبايل.*إلغاء|رقم الموبايل.*الغاء|phone number.*cancel)/i.test(
          lastBot
        );

      const waitingForCancelConfirm =
        /(تأكيد إلغاء الحجز|تأكيد الغاء الحجز|confirm cancellation)/i.test(
          lastBot
        );

      // Step 1: cancellation intent
      if (cancelIntent && !isPhone) {
        const reply =
          messageLang === "ar"
            ? "أكيد. ابعتلي رقم الموبايل المستخدم في الحجز علشان أراجع الحجز وأكمل إلغاءه."
            : "Sure. Please send the phone number used for the booking so I can review it and continue the cancellation.";

        await sharedMemoryService.appendMessage(
          workspace.id,
          params.sessionId,
          {
            sender: "user",
            text: message,
            time: new Date().toISOString(),
            agentRole: "Support"
          }
        );

        await sharedMemoryService.appendMessage(
          workspace.id,
          params.sessionId,
          {
            sender: "bot",
            text: reply,
            time: new Date().toISOString(),
            agentRole: "Support"
          }
        );

        console.log(
          `🗑️ [FOX Booking] Waiting for cancellation phone | Workspace=${workspace.id}`
        );

        return {
          response: reply,
          aiResponse: reply,
          detectedLanguage: messageLang,
          source: "fox_cancel_flow",
          suggestedActions: []
        };
      }

      // Step 2: phone supplied after cancel request
      if (waitingForCancelPhone && isPhone) {
        const appointments =
          await workspaceDataService.getCustomerAppointments(
            workspace.id,
            cancelMessage
          );

        if (appointments.length === 0) {
          const reply =
            messageLang === "ar"
              ? "راجعت النظام ولم أجد أي حجز حالي أو قادم على رقم الموبايل ده."
              : "I checked the system and found no current or upcoming booking on this phone number.";

          return {
            response: reply,
            aiResponse: reply,
            detectedLanguage: messageLang,
            source: "firestore:cancel_lookup",
            suggestedActions: []
          };
        }

        if (appointments.length > 1) {
          const lines = appointments.map(
            (apt: any, index: number) =>
              `${index + 1}) ${apt.date} - ${apt.time}`
          );

          const reply =
            messageLang === "ar"
              ? `لقيت أكتر من حجز على الرقم ده:\n\n${lines.join("\n")}\n\nاكتب رقم الحجز اللي عايز تلغيه.`
              : `I found more than one booking:\n\n${lines.join("\n")}\n\nSend the number of the booking you want to cancel.`;

          // store options in memory in a machine-readable line
          const machineState =
            `CANCEL_OPTIONS:${appointments
              .map((apt: any) => apt.id)
              .join(",")}`;

          await sharedMemoryService.appendMessage(
            workspace.id,
            params.sessionId,
            {
              sender: "bot",
              text: reply + "\n" + machineState,
              time: new Date().toISOString(),
              agentRole: "Support"
            }
          );

          return {
            response: reply,
            aiResponse: reply,
            detectedLanguage: messageLang,
            source: "firestore:cancel_options",
            suggestedActions: []
          };
        }

        const apt: any = appointments[0];

        const reply =
          messageLang === "ar"
            ? `لقيت الحجز ده:\n\nالتاريخ: ${apt.date}\nالوقت: ${apt.time}\n\nلو عايز تكمل، اكتب: تأكيد إلغاء الحجز`
            : `I found this booking:\n\nDate: ${apt.date}\nTime: ${apt.time}\n\nTo continue, send: confirm cancellation`;

        await sharedMemoryService.appendMessage(
          workspace.id,
          params.sessionId,
          {
            sender: "bot",
            text:
              reply +
              `\nCANCEL_APPOINTMENT_ID:${apt.id}`,
            time: new Date().toISOString(),
            agentRole: "Support"
          }
        );

        return {
          response: reply,
          aiResponse: reply,
          detectedLanguage: messageLang,
          source: "firestore:cancel_confirm",
          suggestedActions: []
        };
      }

      // Step 3a: choose from multiple appointments
      const optionState =
        cancelCtx.messages
          .slice()
          .reverse()
          .find((m) =>
            String(m.text || "").includes("CANCEL_OPTIONS:")
          )
          ?.text || "";

      if (
        /^\d+$/.test(cancelMessage) &&
        optionState.includes("CANCEL_OPTIONS:")
      ) {
        const ids =
          optionState
            .split("CANCEL_OPTIONS:")[1]
            ?.split(",")
            .map((x) => x.trim())
            .filter(Boolean) || [];

        const choice = Number(cancelMessage) - 1;

        if (choice >= 0 && choice < ids.length) {
          const selectedId = ids[choice];

          const reply =
            messageLang === "ar"
              ? "تمام. لو متأكد من إلغاء الحجز، اكتب: تأكيد إلغاء الحجز"
              : "Okay. If you're sure, send: confirm cancellation";

          await sharedMemoryService.appendMessage(
            workspace.id,
            params.sessionId,
            {
              sender: "bot",
              text:
                reply +
                `\nCANCEL_APPOINTMENT_ID:${selectedId}`,
              time: new Date().toISOString(),
              agentRole: "Support"
            }
          );

          return {
            response: reply,
            aiResponse: reply,
            detectedLanguage: messageLang,
            source: "firestore:cancel_selected",
            suggestedActions: []
          };
        }
      }

      // Step 3b: final confirmation
      const confirmCancel =
        /(تأكيد\s*إلغاء\s*الحجز|تأكيد\s*الغاء\s*الحجز|confirm\s*cancellation)/i.test(
          cancelMessage
        );

      if (confirmCancel) {
        const idState =
          cancelCtx.messages
            .slice()
            .reverse()
            .find((m) =>
              String(m.text || "").includes(
                "CANCEL_APPOINTMENT_ID:"
              )
            )
            ?.text || "";

        const appointmentId =
          idState.split("CANCEL_APPOINTMENT_ID:")[1]?.trim();

        if (appointmentId) {
          await workspaceDataService.cancelAppointment(
            workspace.id,
            appointmentId
          );

          console.log(
            `🗑️ [FOX CRM] Appointment cancelled | Workspace=${workspace.id} | Appointment=${appointmentId}`
          );

          const reply =
            messageLang === "ar"
              ? "✅ تم إلغاء الحجز بنجاح. لو تحب، أقدر أساعدك تعمل حجز جديد."
              : "✅ Your booking has been cancelled successfully.";

          await sharedMemoryService.appendMessage(
            workspace.id,
            params.sessionId,
            {
              sender: "bot",
              text: reply,
              time: new Date().toISOString(),
              agentRole: "Support"
            }
          );

          return {
            response: reply,
            aiResponse: reply,
            detectedLanguage: messageLang,
            source: "firestore:cancelled",
            suggestedActions:
              messageLang === "ar"
                ? ["حجز موعد جديد"]
                : ["Book New Appointment"]
          };
        }
      }
    }

    // =========================================================
    // DETERMINISTIC CUSTOMER APPOINTMENT LOOKUP
    // Never let the LLM invent whether a booking exists.
    // =========================================================
    if (workspace?.id && params.sessionId) {
      const normalizedMessage = message.trim();
      const lowerMessage = normalizedMessage.toLowerCase();

      const bookingLookupIntent =
        /(عندي\s*(حجز|موعد)|حجز\s*قبل\s*كده|موعد\s*قبل\s*كده|حجوزاتي|مواعيدي|existing\s*(booking|appointment)|my\s*(booking|appointment))/i.test(
          lowerMessage
        );

      const digitsOnly = normalizedMessage.replace(/\D/g, "");

      const looksLikePhone =
        digitsOnly.length >= 10 &&
        digitsOnly.length <= 15;

      const existingContext =
        await sharedMemoryService.getContext(
          workspace.id,
          params.sessionId
        );

      const recentUserMessages =
        existingContext.messages
          .filter((m) => m.sender === "user")
          .slice(-4)
          .map((m) => m.text);

      const lastAssistantMessage =
        existingContext.messages
          .slice()
          .reverse()
          .find((m) => m.sender === "bot")
          ?.text || "";

      const previousAskedForBookingLookup =
        /(رقم الموبايل المستخدم في الحجز|أراجع حجوزاتك|check your appointments|phone number used for the booking)/i.test(
          lastAssistantMessage
        );

      // Step 1: Customer asks whether a booking exists.
      if (bookingLookupIntent && !looksLikePhone) {
        await sharedMemoryService.appendMessage(
          workspace.id,
          params.sessionId,
          {
            sender: "user",
            text: message,
            time: new Date().toISOString(),
            agentRole: "Sales"
          }
        );

        const lookupPrompt =
          messageLang === "ar"
            ? "أكيد. ابعتلي رقم الموبايل المستخدم في الحجز علشان أراجع حجوزاتك المسجلة في النظام."
            : "Sure. Please send the phone number used for the booking so I can check your appointments.";

        await sharedMemoryService.appendMessage(
          workspace.id,
          params.sessionId,
          {
            sender: "bot",
            text: lookupPrompt,
            time: new Date().toISOString(),
            agentRole: "Sales"
          }
        );

        console.log(
          `📞 [FOX CRM] Waiting for customer phone | Workspace=${workspace.id}`
        );

        return {
          response: lookupPrompt,
          aiResponse: lookupPrompt,
          detectedLanguage: messageLang,
          source: "fox_crm_lookup",
          suggestedActions: []
        };
      }

      // Step 2: Next customer message contains phone number.
      if (looksLikePhone && previousAskedForBookingLookup) {
        await sharedMemoryService.appendMessage(
          workspace.id,
          params.sessionId,
          {
            sender: "user",
            text: message,
            time: new Date().toISOString(),
            agentRole: "Sales"
          }
        );

        const appointments =
          await workspaceDataService.getCustomerAppointments(
            workspace.id,
            normalizedMessage
          );

        console.log(
          `🔎 [FOX CRM] Customer appointments lookup | Workspace=${workspace.id} | Phone=${normalizedMessage} | Count=${appointments.length}`
        );

        let replyText = "";

        if (appointments.length === 0) {
          replyText =
            messageLang === "ar"
              ? "راجعت النظام ولم أجد حجوزات حالية أو قادمة مسجلة على رقم الموبايل ده."
              : "I checked the system and found no current or upcoming appointments registered with this phone number.";
        } else {
          const appointmentLines =
            appointments.map((apt: any, index: number) =>
              messageLang === "ar"
                ? `${index + 1}) يوم ${apt.date} الساعة ${apt.time} — الحالة: ${apt.status || "Scheduled"}`
                : `${index + 1}) ${apt.date} at ${apt.time} — Status: ${apt.status || "Scheduled"}`
            );

          replyText =
            messageLang === "ar"
              ? `لقيت ${appointments.length} حجز حالي/قادم على الرقم ده:\n\n${appointmentLines.join("\n")}`
              : `I found ${appointments.length} current/upcoming appointment(s):\n\n${appointmentLines.join("\n")}`;
        }

        await sharedMemoryService.appendMessage(
          workspace.id,
          params.sessionId,
          {
            sender: "bot",
            text: replyText,
            time: new Date().toISOString(),
            agentRole: "Sales"
          }
        );

        return {
          response: replyText,
          aiResponse: replyText,
          detectedLanguage: messageLang,
          source: "firestore:appointments",
          suggestedActions:
            messageLang === "ar"
              ? ["حجز موعد جديد", "تعديل موعد"]
              : ["Book New Appointment", "Modify Appointment"]
        };
      }
    }

    // =========================================================
    // DETERMINISTIC NEW BOOKING IDENTITY GUARD
    // A new booking must use fresh/reconfirmed customer identity.
    // =========================================================
    if (workspace?.id && params.sessionId) {
      const newBookingIntent =
        /(عاوز\s*أحجز|عايز\s*أحجز|أريد\s*حجز|اريد\s*حجز|احجز|أحجز|book\s+an?\s*appointment|book\s+appointment|reserve)/i.test(
          message
        );

      const currentDigits =
        String(message || "").replace(/\D/g, "");

      const hasCurrentPhone =
        currentDigits.length >= 10 &&
        currentDigits.length <= 15;

      // We deliberately require the customer to provide/reconfirm
      // identity in the CURRENT booking conversation.
      if (newBookingIntent && !hasCurrentPhone) {
        await sharedMemoryService.appendMessage(
          workspace.id,
          params.sessionId,
          {
            sender: "user",
            text: message,
            time: new Date().toISOString(),
            agentRole: "Sales"
          }
        );

        const bookingDetailsPrompt =
          messageLang === "ar"
            ? "تمام ✅ قبل تأكيد الحجز، ابعتلي **اسم صاحب الحجز ورقم الموبايل** المستخدم في الحجز."
            : "Great ✅ Before confirming the booking, please send the **customer name and phone number** for this booking.";

        await sharedMemoryService.appendMessage(
          workspace.id,
          params.sessionId,
          {
            sender: "bot",
            text: bookingDetailsPrompt,
            time: new Date().toISOString(),
            agentRole: "Sales"
          }
        );

        console.log(
          `📝 [FOX Booking] Waiting for fresh customer identity | Workspace=${workspace.id}`
        );

        return {
          response: bookingDetailsPrompt,
          aiResponse: bookingDetailsPrompt,
          detectedLanguage: messageLang,
          source: "fox_booking_guard",
          suggestedActions: []
        };
      }
    }

    // =========================================================
    // DETERMINISTIC BOOKING FOLLOW-UP
    // If FOX previously asked for fresh name + phone, complete
    // the booking server-side instead of depending on LLM tools.
    // =========================================================
    if (workspace?.id && params.sessionId) {
      try {
        const bookingCtx =
          await sharedMemoryService.getContext(
            workspace.id,
            params.sessionId
          );

        const lastBotText =
          bookingCtx.messages
            .slice()
            .reverse()
            .find((m) => m.sender === "bot")
            ?.text || "";

        const waitingForIdentity =
          /(اسم صاحب الحجز ورقم الموبايل|customer name and phone number)/i.test(
            lastBotText
          );

        if (waitingForIdentity) {
          const lines = String(message || "")
            .split(/\n+/)
            .map((x) => x.trim())
            .filter(Boolean);

          const phoneLine =
            lines.find((line) => {
              const digits = line.replace(/\D/g, "");
              return digits.length >= 10 && digits.length <= 15;
            }) || "";

          const phone =
            phoneLine.replace(/\D/g, "");

          const customerName =
            lines
              .filter((line) => line !== phoneLine)
              .join(" ")
              .trim();

          const originalBookingRequest =
            bookingCtx.messages
              .slice()
              .reverse()
              .find(
                (m) =>
                  m.sender === "user" &&
                  /(عاوز\s*أحجز|عايز\s*أحجز|أريد\s*حجز|اريد\s*حجز|احجز|أحجز|book\s+an?\s*appointment|reserve)/i.test(
                    m.text || ""
                  )
              )
              ?.text || "";

          if (
            phone.length >= 10 &&
            customerName.length >= 2 &&
            originalBookingRequest
          ) {
            // -------------------------------
            // Parse Arabic / English date
            // -------------------------------
            const arabicMonths: Record<string, number> = {
              "يناير": 1,
              "فبراير": 2,
              "مارس": 3,
              "أبريل": 4,
              "ابريل": 4,
              "مايو": 5,
              "يونيو": 6,
              "يوليو": 7,
              "أغسطس": 8,
              "اغسطس": 8,
              "سبتمبر": 9,
              "أكتوبر": 10,
              "اكتوبر": 10,
              "نوفمبر": 11,
              "ديسمبر": 12
            };

            let bookingDate = "";
            let bookingTime = "";

            const now = new Date();
            const currentYear = now.getFullYear();

            // Arabic date: 22 أغسطس
            const dateMatch =
              originalBookingRequest.match(
                /(\d{1,2})\s+(يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)/i
              );

            if (dateMatch) {
              const day = Number(dateMatch[1]);
              const month =
                arabicMonths[dateMatch[2]];

              if (month) {
                bookingDate =
                  `${currentYear}-` +
                  `${String(month).padStart(2, "0")}-` +
                  `${String(day).padStart(2, "0")}`;
              }
            }

            // ------------------------------------------------
            // Parse appointment TIME only from an explicit time phrase.
            // Never mistake the DAY number (e.g. 23 August) for the hour.
            // Examples:
            // الساعة 1 ظهراً  -> 01:00 PM
            // الساعة 10 صباحاً -> 10:00 AM
            // 2:30 مساءً       -> 02:30 PM
            // ------------------------------------------------
            const timeMatch =
              originalBookingRequest.match(
                /(?:الساعة\s+|الساعة\s*|at\s+)(\d{1,2})(?::(\d{2}))?\s*(صباحاً|صباحا|صباحًا|صباح|ظهراً|ظهرا|ظهرًا|ظهر|مساءً|مساءا|مساء|am|pm)/i
              );

            if (timeMatch) {
              let hour12 = Number(timeMatch[1]);
              const minute = Number(timeMatch[2] || 0);

              const period =
                String(timeMatch[3] || "").toLowerCase();

              if (
                hour12 < 1 ||
                hour12 > 12 ||
                minute < 0 ||
                minute > 59
              ) {
                bookingTime = "";
              } else {
                const isPM =
                  /ظهر|مساء|pm/.test(period);

                const suffix = isPM ? "PM" : "AM";

                bookingTime =
                  `${String(hour12).padStart(2, "0")}:` +
                  `${String(minute).padStart(2, "0")} ${suffix}`;
              }
            }

            if (!bookingDate || !bookingTime) {
              const msg =
                messageLang === "ar"
                  ? "محتاج أتأكد من تاريخ ووقت الحجز. اكتبهم مرة تانية مثلاً: 22 أغسطس الساعة 12 ظهراً."
                  : "I need to confirm the appointment date and time. Please send them again.";

              return {
                response: msg,
                aiResponse: msg,
                detectedLanguage: messageLang,
                source: "fox_booking_parser",
                suggestedActions: []
              };
            }

            const available =
              await workspaceDataService.isAppointmentAvailable(
                workspace.id,
                bookingDate,
                bookingTime
              );

            if (!available) {
              const msg =
                messageLang === "ar"
                  ? `الموعد ${bookingDate} الساعة ${bookingTime} غير متاح حالياً. اختار وقت تاني من فضلك.`
                  : `The appointment on ${bookingDate} at ${bookingTime} is not available. Please choose another time.`;

              return {
                response: msg,
                aiResponse: msg,
                detectedLanguage: messageLang,
                source: "firestore:availability",
                suggestedActions: []
              };
            }

            const lead =
              await workspaceDataService.upsertLead(
                workspace.id,
                {
                  name: customerName,
                  phone,
                  channel,
                  sessionId: params.sessionId
                }
              );

            const appointment =
              await workspaceDataService.createAppointment(
                workspace.id,
                {
                  customerName,
                  phone,
                  date: bookingDate,
                  time: bookingTime,
                  channel,
                  sessionId: params.sessionId
                }
              );

            console.log(
              `✅ [FOX CRM] Direct appointment saved | Workspace=${workspace.id} | Customer=${customerName} | ${bookingDate} ${bookingTime}`
            );

            if (
              workspace.externalCrmWebhookUrl
            ) {
              try {
                triggerExternalCRM(
                  workspace.id,
                  "booking",
                  {
                    appointment,
                    lead,
                    date: bookingDate,
                    time: bookingTime,
                    name: customerName,
                    phone,
                    channel
                  },
                  workspace.externalCrmWebhookUrl
                );
              } catch (err) {
                console.warn(
                  "[FOX CRM] External webhook failed; booking remains saved.",
                  err
                );
              }
            }

            const bookingLanguage =
              this.detectLanguage(originalBookingRequest);

            const confirmation =
              bookingLanguage === "ar"
                ? `✅ تم تأكيد حجزك بنجاح 🎉\n\nالاسم: ${customerName}\nالتاريخ: ${bookingDate}\nالوقت: ${bookingTime}\n\nنتشرف بخدمتك في ${workspace.name || "العيادة"}.`
                : `✅ Your appointment has been confirmed successfully.\n\nName: ${customerName}\nDate: ${bookingDate}\nTime: ${bookingTime}`;

            await sharedMemoryService.appendMessage(
              workspace.id,
              params.sessionId,
              {
                sender: "user",
                text: message,
                time: new Date().toISOString(),
                agentRole: "Sales"
              }
            );

            await sharedMemoryService.appendMessage(
              workspace.id,
              params.sessionId,
              {
                sender: "bot",
                text: confirmation,
                time: new Date().toISOString(),
                agentRole: "Sales"
              }
            );

            return {
              response: confirmation,
              aiResponse: confirmation,
              detectedLanguage: this.detectLanguage(originalBookingRequest),
              source: "firestore:direct_booking",
              suggestedActions:
                messageLang === "ar"
                  ? ["عرض حجوزاتي", "تعديل الموعد", "إلغاء الموعد"]
                  : ["My Appointments", "Modify Appointment", "Cancel Appointment"]
            };
          }
        }
      } catch (bookingError) {
        console.error(
          "❌ [FOX Direct Booking Error]",
          bookingError
        );
      }
    }

    // FOX Smart Agent Router
    let forcedBookingSales = false;

    if (workspace?.id && params.sessionId) {
      try {
        const bookingCtx =
          await sharedMemoryService.getContext(
            workspace.id,
            params.sessionId
          );

        const lastBotText =
          bookingCtx.messages
            .slice()
            .reverse()
            .find((m) => m.sender === "bot")
            ?.text || "";

        forcedBookingSales =
          /(اسم صاحب الحجز ورقم الموبايل|customer name and phone number)/i.test(
            lastBotText
          );
      } catch {
        forcedBookingSales = false;
      }
    }

    const agentRole: "Sales" | "Support" | "Marketing" =
      forcedBookingSales
        ? "Sales"
        : await this.detectAgentRole(workspace, message);

    const roleConfig: Partial<AiAgentConfig> =
      agentRole === "Sales"
        ? {
            agentName:
              workspace.aiSettings?.salesAgentName ||
              "FOX Sales Agent",
            customPrompt:
              workspace.aiSettings?.salesAgentPrompt ||
              "Act as a professional sales consultant. Understand customer needs, recommend the most suitable service, answer pricing accurately and guide the customer naturally toward booking, ordering or subscribing without being pushy.",
          }
        : agentRole === "Marketing"
        ? {
            agentName:
              workspace.aiSettings?.marketingAgentName ||
              "FOX Marketing Agent",
            customPrompt:
              workspace.aiSettings?.marketingAgentPrompt ||
              "Act as a marketing and growth specialist. Explain approved offers and benefits, recommend relevant services and identify ethical upsell opportunities. Never invent discounts.",
          }
        : {
            agentName:
              workspace.aiSettings?.supportAgentName ||
              "FOX Support Agent",
            customPrompt:
              workspace.aiSettings?.supportAgentPrompt ||
              "Act as an expert customer support specialist. Diagnose problems, respond empathetically, solve issues using approved business information and escalate when human intervention is required.",
          };

    const effectiveConfig: Partial<AiAgentConfig> = {
      ...roleConfig,
      ...overrideConfig,
    };

    console.log(
      `[Smart Router] ${channel} -> ${agentRole}: ${message.substring(0, 120)}`
    );

    const todayISO = new Date().toISOString().slice(0, 10);

    const systemInstruction =
      this.buildSystemInstruction(
        workspace,
        messageLang,
        channel,
        effectiveConfig
      ) +
      `

CURRENT DATE:
${todayISO}

DATE SAFETY RULES:
- Never create or confirm an appointment in the past.
- If the customer says "tomorrow", "بكرة", "next week", or another relative date, resolve it using CURRENT DATE above.
- Never guess a previous year from conversation history.
- Never reuse an old customer's name or phone for a new booking unless the customer provided or clearly reconfirmed them in the current booking conversation.
- Asking about available appointments is NOT permission to create a booking.
`;

    const openRouter = this.getOpenRouterClient();
    const ai = this.getGeminiClient();

    // OpenRouter is the primary provider.
    // Gemini remains available as a fallback.
    if (!openRouter && !ai) {
      const msgLower = message.toLowerCase();
      const isAr = messageLang === "ar";
      const businessName = workspace.name || "Fox Business";
      const agentName = workspace.aiSettings?.agentName || `${businessName} AI Assistant`;

      let responseText = "";
      if (isAr) {
        responseText = `أهلاً بك في ${businessName}! أنا ${agentName}، المساعد الذكي الخاص بالنشاط. `;
        if (
          msgLower.includes("سعر") ||
          msgLower.includes("كام") ||
          msgLower.includes("بكام") ||
          msgLower.includes("منيو") ||
          msgLower.includes("دكتور")
        ) {
          responseText += `إليك تفاصيل الخدمات والأسعار المتاحة لدينا بالجنيه المصري (EGP). يسعدنا تزويدك بأي معلومات إضافية تحتاجها!`;
        } else if (msgLower.includes("حجز") || msgLower.includes("موعد") || msgLower.includes("احجز")) {
          responseText += `يمكنني مساعدتك في تسجيل حجزك فوراً! يرجى تزويدي باسمك ورقم هاتفك والموعد المفضل وسأقوم بحفظه في الـ CRM.`;
        } else {
          responseText += `كيف يمكنني مساعدتك اليوم؟ يمكنك الاستفسار عن الخدمات والأسعار أو طلب المواعيد.`;
        }
      } else {
        responseText = `Hello! Welcome to ${businessName}. I am ${agentName}. `;
        if (msgLower.includes("price") || msgLower.includes("cost") || msgLower.includes("menu") || msgLower.includes("doctor")) {
          responseText += `Here are our available services and catalog prices in EGP. Feel free to ask any questions!`;
        } else if (msgLower.includes("book") || msgLower.includes("appointment")) {
          responseText += `I can help you book an appointment! Please provide your name, phone number, and preferred slot for CRM registration.`;
        } else {
          responseText += `How may I assist you today? You can ask about our catalog, pricing, or book an appointment.`;
        }
      }

      return {
        response: responseText,
        aiResponse: responseText,
        detectedLanguage: messageLang,
        source: "fallback_engine",
        suggestedActions:
          messageLang === "ar"
            ? ["حجز موعد", "استعراض الأسعار", "التحدث مع مسؤول"]
            : ["Book Appointment", "View Catalog", "Contact Support"],
      };
    }

    try {
      const formattedContents: any[] = [];
      let finalChatHistory = chatHistory;
      
      // Use SharedMemoryContext if sessionId and workspaceId are provided
      if (params.sessionId && workspace.id) {
        const sharedCtx = await sharedMemoryService.getContext(workspace.id, params.sessionId);
        if (sharedCtx.messages.length > 0) {
          finalChatHistory = sharedCtx.messages.map(m => ({
            role: m.sender === "user" ? "user" : "model",
            text: m.text,
          }));
        }
        // Append current user message to shared memory
        await sharedMemoryService.appendMessage(workspace.id, params.sessionId, {
          sender: "user",
          text: message,
          time: new Date().toISOString()
        });
      }

      for (const h of finalChatHistory) {
        const text = h.text || h.parts?.[0]?.text;
        if (text) {
          const role = h.sender === "user" || h.role === "user" ? "user" : "model";
          formattedContents.push({
            role,
            parts: [{ text }],
          });
        }
      }

      formattedContents.push({
        role: "user",
        parts: [{ text: message }],
      });

      const FALLBACK_MODELS = [
        "gemini-3.6-flash",
        "gemini-3.1-pro-preview",
        "gemini-flash-latest"
      ];

      // =========================================================
      // FOX NATIVE CRM TOOLS
      // Firestore is the primary database.
      // Google Sheets / external CRM are optional integrations.
      // =========================================================
      const tools = [
        {
          functionDeclarations: [
            {
              name: "checkAppointmentAvailability",
              description:
                "Check whether a requested appointment date and time is available in this business workspace.",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  date: {
                    type: Type.STRING,
                    description: "Appointment date in YYYY-MM-DD format"
                  },
                  time: {
                    type: Type.STRING,
                    description: "Appointment time, for example 10:00 AM"
                  }
                },
                required: ["date", "time"]
              }
            },
            {
              name: "bookAppointment",
              description:
                "Create and confirm an appointment only after customer name, phone, date and time have all been collected.",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  date: {
                    type: Type.STRING,
                    description: "Appointment date in YYYY-MM-DD format"
                  },
                  time: {
                    type: Type.STRING,
                    description: "Appointment time"
                  },
                  name: {
                    type: Type.STRING,
                    description: "Customer full name"
                  },
                  phone: {
                    type: Type.STRING,
                    description: "Customer phone number"
                  }
                },
                required: ["date", "time", "name", "phone"]
              }
            },
            {
              name: "recordSale",
              description:
                "Record a confirmed successful sale or order.",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  itemName: {
                    type: Type.STRING,
                    description: "Item, service or package sold"
                  },
                  price: {
                    type: Type.NUMBER,
                    description: "Total sale price"
                  },
                  customerName: {
                    type: Type.STRING,
                    description: "Customer name"
                  },
                  customerPhone: {
                    type: Type.STRING,
                    description: "Customer phone"
                  }
                },
                required: [
                  "itemName",
                  "price",
                  "customerName",
                  "customerPhone"
                ]
              }
            }
          ]
        }
      ];

      // =========================================================
      // OPENROUTER PRIMARY AI ENGINE
      // Gemini below remains the fallback provider.
      // =========================================================

      if (openRouter) {
        try {
          console.log(
            `🟢 [OpenRouter] Primary AI request | Workspace=${workspace.id || "unknown"} | Agent=${agentRole}`
          );

          const openRouterMessages: any[] = [
            {
              role: "system",
              content: systemInstruction
            }
          ];

          for (const h of finalChatHistory) {
            const text = h.text || h.parts?.[0]?.text;

            if (!text) continue;

            openRouterMessages.push({
              role:
                h.sender === "user" || h.role === "user"
                  ? "user"
                  : "assistant",
              content: text
            });
          }

          openRouterMessages.push({
            role: "user",
            content: message
          });

          const openRouterTools: any[] = [
            {
              type: "function",
              function: {
                name: "checkAppointmentAvailability",
                description:
                  "Check whether a requested appointment date and time is available in this business workspace.",
                parameters: {
                  type: "object",
                  properties: {
                    date: {
                      type: "string",
                      description: "Appointment date in YYYY-MM-DD format"
                    },
                    time: {
                      type: "string",
                      description: "Appointment time, for example 10:00 AM"
                    }
                  },
                  required: ["date", "time"]
                }
              }
            },
            {
              type: "function",
              function: {
                name: "bookAppointment",
                description:
                  "Create and confirm an appointment only after customer name, phone, date and time have all been collected.",
                parameters: {
                  type: "object",
                  properties: {
                    date: {
                      type: "string",
                      description: "Appointment date in YYYY-MM-DD format"
                    },
                    time: {
                      type: "string",
                      description: "Appointment time"
                    },
                    name: {
                      type: "string",
                      description: "Customer full name"
                    },
                    phone: {
                      type: "string",
                      description: "Customer phone number"
                    }
                  },
                  required: ["date", "time", "name", "phone"]
                }
              }
            },
            {
              type: "function",
              function: {
                name: "getCustomerAppointments",
                description:
                  "Read the customer's real current/future appointments from FOX CRM. Use this before claiming that a customer already has a booking.",
                parameters: {
                  type: "object",
                  properties: {
                    phone: {
                      type: "string",
                      description: "Customer phone number"
                    }
                  },
                  required: ["phone"]
                }
              }
            },
            {
              type: "function",
              function: {
                name: "getAppointmentsForDate",
                description:
                  "Read the appointments already booked for a specific date from FOX CRM. This returns booked appointments, not invented availability.",
                parameters: {
                  type: "object",
                  properties: {
                    date: {
                      type: "string",
                      description: "Date in YYYY-MM-DD format"
                    }
                  },
                  required: ["date"]
                }
              }
            },
            {
              type: "function",
              function: {
                name: "recordSale",
                description:
                  "Record a confirmed successful sale or order.",
                parameters: {
                  type: "object",
                  properties: {
                    itemName: {
                      type: "string",
                      description: "Item, service or package sold"
                    },
                    price: {
                      type: "number",
                      description: "Total sale price"
                    },
                    customerName: {
                      type: "string",
                      description: "Customer name"
                    },
                    customerPhone: {
                      type: "string",
                      description: "Customer phone"
                    }
                  },
                  required: [
                    "itemName",
                    "price",
                    "customerName",
                    "customerPhone"
                  ]
                }
              }
            }
          ];

          let orCompletion: any = null;
          let finalOpenRouterText = "";

          // Allow several tool turns:
          // availability -> collect info -> booking -> final confirmation.
          for (let toolRound = 0; toolRound < 5; toolRound++) {
            orCompletion = await openRouter.chat.completions.create({
              model: process.env.OPENROUTER_MODEL || "openrouter/free",
              messages: openRouterMessages,
              tools: openRouterTools,
              tool_choice: "auto",
              temperature: 0.3
            });

            const orMessage: any =
              orCompletion.choices?.[0]?.message;

            if (!orMessage) {
              throw new Error(
                "OpenRouter returned no assistant message"
              );
            }

            const toolCalls: any[] =
              orMessage.tool_calls || [];

            // No tool call = final normal AI answer.
            if (toolCalls.length === 0) {
              finalOpenRouterText =
                typeof orMessage.content === "string"
                  ? orMessage.content
                  : "";

              break;
            }

            // Preserve the assistant tool-call message.
            openRouterMessages.push(orMessage);

            for (const toolCall of toolCalls) {
              const toolName =
                toolCall?.function?.name;

              let args: any = {};

              try {
                args = JSON.parse(
                  toolCall?.function?.arguments || "{}"
                );
              } catch {
                args = {};
              }

              console.log(
                `🔧 [OpenRouter Tool] ${toolName} | Workspace=${workspace.id || "unknown"}`
              );

              let functionResult: any = {};

              try {
                if (
                  toolName ===
                  "checkAppointmentAvailability"
                ) {
                  const { date, time } = args;

                  const isAvailable =
                    await workspaceDataService.isAppointmentAvailable(
                      workspace.id,
                      date,
                      time
                    );

                  functionResult = {
                    available: isAvailable,
                    date,
                    time,
                    message: isAvailable
                      ? "Slot is available."
                      : "Slot is already booked. Please suggest another time."
                  };

                  // =====================================================
                  // DETERMINISTIC BOOKING COMPLETION
                  // Some OpenRouter free models stop after availability
                  // instead of calling bookAppointment. If this is the
                  // fresh identity follow-up of an explicit booking flow,
                  // complete the booking server-side.
                  // =====================================================
                  if (isAvailable && params.sessionId && workspace.id) {
                    const currentLines = String(message || "")
                      .split(/\n+/)
                      .map((x) => x.trim())
                      .filter(Boolean);

                    const phoneLine =
                      currentLines.find((line) => {
                        const digits = line.replace(/\D/g, "");
                        return digits.length >= 10 && digits.length <= 15;
                      }) || "";

                    const freshPhone =
                      phoneLine.replace(/\D/g, "");

                    const freshName =
                      currentLines
                        .filter((line) => line !== phoneLine)
                        .join(" ")
                        .trim();

                    const bookingCtx =
                      await sharedMemoryService.getContext(
                        workspace.id,
                        params.sessionId
                      );

                    const lastBotText =
                      bookingCtx.messages
                        .slice()
                        .reverse()
                        .find((m) => m.sender === "bot")
                        ?.text || "";

                    const wasWaitingForFreshIdentity =
                      /(اسم صاحب الحجز ورقم الموبايل|customer name and phone number)/i.test(
                        lastBotText
                      );

                    const previousUserBookingRequest =
                      bookingCtx.messages
                        .slice()
                        .reverse()
                        .find(
                          (m) =>
                            m.sender === "user" &&
                            /(عاوز\s*أحجز|عايز\s*أحجز|أريد\s*حجز|اريد\s*حجز|احجز|أحجز|book\s+an?\s*appointment|reserve)/i.test(
                              m.text || ""
                            )
                        );

                    if (
                      wasWaitingForFreshIdentity &&
                      previousUserBookingRequest &&
                      freshName.length >= 2 &&
                      freshPhone.length >= 10
                    ) {
                      // Re-check immediately before the write.
                      const stillAvailable =
                        await workspaceDataService.isAppointmentAvailable(
                          workspace.id,
                          date,
                          time
                        );

                      if (stillAvailable) {
                        const lead =
                          await workspaceDataService.upsertLead(
                            workspace.id,
                            {
                              name: freshName,
                              phone: freshPhone,
                              channel,
                              sessionId: params.sessionId
                            }
                          );

                        const appointment =
                          await workspaceDataService.createAppointment(
                            workspace.id,
                            {
                              customerName: freshName,
                              phone: freshPhone,
                              date,
                              time,
                              channel,
                              sessionId: params.sessionId
                            }
                          );

                        if (
                          workspace.googleSheetsAccessToken &&
                          workspace.crmSpreadsheetId
                        ) {
                          try {
                            await bookAppointmentInSheet(
                              workspace.googleSheetsAccessToken,
                              workspace.crmSpreadsheetId,
                              date,
                              time,
                              freshName,
                              freshPhone
                            );
                          } catch (sheetError) {
                            console.warn(
                              "[FOX CRM] Google Sheets sync failed; Firestore booking remains saved.",
                              sheetError
                            );
                          }
                        }

                        if (workspace.externalCrmWebhookUrl) {
                          try {
                            triggerExternalCRM(
                              workspace.id,
                              "booking",
                              {
                                appointment,
                                lead,
                                date,
                                time,
                                name: freshName,
                                phone: freshPhone,
                                channel
                              },
                              workspace.externalCrmWebhookUrl
                            );
                          } catch (webhookError) {
                            console.warn(
                              "[FOX CRM] External CRM webhook failed; Firestore booking remains saved.",
                              webhookError
                            );
                          }
                        }

                        console.log(
                          `✅ [FOX CRM] Deterministic appointment saved | Workspace=${workspace.id} | Customer=${freshName} | ${date} ${time}`
                        );

                        functionResult = {
                          success: true,
                          available: true,
                          bookingCreated: true,
                          date,
                          time,
                          customerName: freshName
                        };

                        finalOpenRouterText =
                          messageLang === "ar"
                            ? `✅ تم تأكيد حجزك بنجاح.\n\nالاسم: ${freshName}\nالتاريخ: ${date}\nالوقت: ${time}\n\nنتشرف بخدمتك.`
                            : `✅ Your appointment has been confirmed successfully.\n\nName: ${freshName}\nDate: ${date}\nTime: ${time}\n\nWe look forward to serving you.`;
                      }
                    }
                  }

                } else if (
                  toolName === "bookAppointment"
                ) {
                  const {
                    date,
                    time,
                    name,
                    phone
                  } = args;

                  // -------------------------------------------------
                  // TRANSACTION SAFETY GUARD
                  // Never trust booking identity only because the LLM
                  // remembered it from an older conversation.
                  // -------------------------------------------------
                  const recentUserContext = [
                    ...finalChatHistory
                      .filter(
                        (h: any) =>
                          h.sender === "user" ||
                          h.role === "user"
                      )
                      .slice(-4)
                      .map(
                        (h: any) =>
                          h.text ||
                          h.parts?.[0]?.text ||
                          ""
                      ),
                    message
                  ].join("\n");

                  const recentAssistantContext =
                    finalChatHistory
                      .filter(
                        (h: any) =>
                          h.sender !== "user" &&
                          h.role !== "user"
                      )
                      .slice(-2)
                      .map(
                        (h: any) =>
                          h.text ||
                          h.parts?.[0]?.text ||
                          ""
                      )
                      .join("\n");

                  const userDigits =
                    recentUserContext.replace(/\D/g, "");

                  const phoneDigits =
                    String(phone || "").replace(/\D/g, "");

                  const normalizedName =
                    String(name || "")
                      .trim()
                      .toLowerCase();

                  const normalizedUserContext =
                    recentUserContext.toLowerCase();

                  const userProvidedPhone =
                    phoneDigits.length >= 8 &&
                    userDigits.includes(
                      phoneDigits.slice(-8)
                    );

                  const userProvidedName =
                    normalizedName.length >= 3 &&
                    normalizedUserContext.includes(
                      normalizedName
                    );

                  const explicitBookingIntent =
                    /(عاوز\s*أحجز|عايز\s*أحجز|اريد\s*حجز|أريد\s*حجز|احجز|أحجز|book\s|book an appointment|reserve)/i.test(
                      recentUserContext
                    );

                  const assistantRequestedDetails =
                    /(الاسم|اسمك|رقم الهاتف|رقم الموبايل|الموبايل|phone|name).*(موعد|تاريخ|وقت|date|time)|(?:موعد|تاريخ|وقت|date|time).*(الاسم|اسمك|رقم الهاتف|رقم الموبايل|phone|name)/is.test(
                      recentAssistantContext
                    );

                  const validDateFormat =
                    /^\d{4}-\d{2}-\d{2}$/.test(
                      String(date || "")
                    );

                  const todayForBooking =
                    new Date()
                      .toISOString()
                      .slice(0, 10);

                  const dateIsNotPast =
                    validDateFormat &&
                    String(date) >= todayForBooking;

                  if (
                    !date ||
                    !time ||
                    !name ||
                    !phone
                  ) {
                    functionResult = {
                      success: false,
                      message:
                        "Missing required booking information. Ask the customer for name, phone, date and time."
                    };

                  } else if (!dateIsNotPast) {
                    functionResult = {
                      success: false,
                      message:
                        `The requested appointment date (${date}) is invalid or in the past. Today is ${todayForBooking}. Ask the customer for a valid future date.`
                    };

                  } else if (
                    !userProvidedPhone ||
                    !userProvidedName
                  ) {
                    functionResult = {
                      success: false,
                      message:
                        "Do NOT create the booking yet. The customer must provide or reconfirm their current name and phone number in this booking conversation. Do not reuse identity data from old memory."
                    };

                  } else if (
                    !explicitBookingIntent &&
                    !assistantRequestedDetails
                  ) {
                    functionResult = {
                      success: false,
                      message:
                        "This conversation does not contain enough evidence of an active booking request. Do not create an appointment. Answer the availability question only."
                    };

                  } else {
                    // Re-check immediately before saving.
                    const isAvailable =
                      await workspaceDataService.isAppointmentAvailable(
                        workspace.id,
                        date,
                        time
                      );

                    if (!isAvailable) {
                      functionResult = {
                        success: false,
                        message:
                          "This appointment slot is already booked. Ask the customer to choose another time."
                      };
                    } else {
                      const lead =
                        await workspaceDataService.upsertLead(
                          workspace.id,
                          {
                            name,
                            phone,
                            channel,
                            sessionId:
                              params.sessionId
                          }
                        );

                      const appointment =
                        await workspaceDataService.createAppointment(
                          workspace.id,
                          {
                            customerName: name,
                            phone,
                            date,
                            time,
                            channel,
                            sessionId:
                              params.sessionId
                          }
                        );

                      // Optional Google Sheets sync.
                      if (
                        workspace.googleSheetsAccessToken &&
                        workspace.crmSpreadsheetId
                      ) {
                        try {
                          await bookAppointmentInSheet(
                            workspace.googleSheetsAccessToken,
                            workspace.crmSpreadsheetId,
                            date,
                            time,
                            name,
                            phone
                          );
                        } catch (sheetError) {
                          console.warn(
                            "[FOX CRM] Google Sheets sync failed; Firestore booking remains saved.",
                            sheetError
                          );
                        }
                      }

                      // Optional external CRM / n8n.
                      if (
                        workspace.externalCrmWebhookUrl
                      ) {
                        try {
                          triggerExternalCRM(
                            workspace.id,
                            "booking",
                            {
                              appointment,
                              lead,
                              date,
                              time,
                              name,
                              phone,
                              channel
                            },
                            workspace.externalCrmWebhookUrl
                          );
                        } catch (webhookError) {
                          console.warn(
                            "[FOX CRM] External CRM webhook failed; Firestore booking remains saved.",
                            webhookError
                          );
                        }
                      }

                      console.log(
                        `✅ [FOX CRM] Appointment saved | Workspace=${workspace.id} | Customer=${name} | ${date} ${time}`
                      );

                      functionResult = {
                        success: true,
                        appointmentId: appointment.id,
                        leadId: lead.id,
                        date,
                        time,
                        customerName: name,
                        phone,
                        message:
                          "Appointment booked successfully."
                      };

                      // Customer-facing confirmation is deterministic.
                      // Do not expose internal CRM IDs.
                      finalOpenRouterText =
                        messageLang === "ar"
                          ? `✅ تم تأكيد حجزك بنجاح.\n\nالاسم: ${name}\nالتاريخ: ${date}\nالوقت: ${time}\n\nنتشرف بخدمتك.`
                          : `✅ Your appointment has been confirmed successfully.\n\nName: ${name}\nDate: ${date}\nTime: ${time}\n\nWe look forward to serving you.`;
                    }
                  }

                } else if (
                  toolName === "getCustomerAppointments"
                ) {
                  const { phone } = args;

                  if (!phone) {
                    functionResult = {
                      success: false,
                      message:
                        "Customer phone number is required before checking existing appointments."
                    };
                  } else {
                    const appointments =
                      await workspaceDataService.getCustomerAppointments(
                        workspace.id,
                        phone
                      );

                    console.log(
                      `🔎 [FOX CRM] Customer appointments lookup | Workspace=${workspace.id} | Count=${appointments.length}`
                    );

                    functionResult = {
                      success: true,
                      count: appointments.length,
                      appointments: appointments.map((apt: any) => ({
                        date: apt.date,
                        time: apt.time,
                        status: apt.status
                      }))
                    };
                  }

                } else if (
                  toolName === "getAppointmentsForDate"
                ) {
                  const { date } = args;

                  if (!date) {
                    functionResult = {
                      success: false,
                      message: "Date is required."
                    };
                  } else {
                    const appointments =
                      await workspaceDataService.getAppointmentsForDate(
                        workspace.id,
                        date
                      );

                    console.log(
                      `📅 [FOX CRM] Date appointments lookup | Workspace=${workspace.id} | Date=${date} | Count=${appointments.length}`
                    );

                    functionResult = {
                      success: true,
                      date,
                      bookedSlots: appointments.map((apt: any) => ({
                        time: apt.time,
                        status: apt.status
                      }))
                    };
                  }

                } else if (
                  toolName === "recordSale"
                ) {
                  const {
                    itemName,
                    price,
                    customerName,
                    customerPhone
                  } = args;

                  if (
                    workspace.externalCrmWebhookUrl
                  ) {
                    triggerExternalCRM(
                      workspace.id,
                      "sale",
                      {
                        itemName,
                        price,
                        customerName,
                        customerPhone
                      },
                      workspace.externalCrmWebhookUrl
                    );
                  }

                  functionResult = {
                    success: true,
                    message:
                      "Sale recorded successfully."
                  };

                } else {
                  functionResult = {
                    success: false,
                    error:
                      `Unknown FOX tool: ${toolName}`
                  };
                }

              } catch (toolError: any) {
                console.error(
                  `❌ [OpenRouter Tool Error] ${toolName}:`,
                  toolError
                );

                functionResult = {
                  success: false,
                  error:
                    toolError?.message ||
                    "Tool execution failed"
                };
              }

              openRouterMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(functionResult)
              });

              if (
                finalOpenRouterText &&
                (
                  (toolName === "bookAppointment" &&
                    functionResult?.success === true) ||
                  functionResult?.bookingCreated === true
                )
              ) {
                break;
              }
            }

            if (finalOpenRouterText) {
              break;
            }
          }

          if (!finalOpenRouterText) {
            throw new Error(
              "OpenRouter tool loop ended without a final text response"
            );
          }

          console.log(
            `✅ [OpenRouter] Response completed | Model=${orCompletion?.model || "openrouter/free"}`
          );

          // Save bot reply in this tenant's shared memory.
          if (
            params.sessionId &&
            workspace.id
          ) {
            await sharedMemoryService.appendMessage(
              workspace.id,
              params.sessionId,
              {
                sender: "bot",
                text: finalOpenRouterText,
                time: new Date().toISOString(),
                agentRole
              }
            );
          }

          return {
            response: finalOpenRouterText,
            aiResponse: finalOpenRouterText,
            detectedLanguage: messageLang,
            source:
              `openrouter:${orCompletion?.model || process.env.OPENROUTER_MODEL || "openrouter/free"}`,
            suggestedActions:
              messageLang === "ar"
                ? [
                    "حجز موعد",
                    "التأكد من المواعيد المتاحة",
                    "التحدث مع موظف"
                  ]
                : [
                    "Book Appointment",
                    "Check Availability",
                    "Speak to Human Agent"
                  ]
          };

        } catch (openRouterError: any) {
          console.warn(
            `🟠 [OpenRouter] Primary provider failed: ${openRouterError?.message || openRouterError}`
          );

          if (ai) {
            console.log(
              "🔵 [Gemini] Switching to fallback provider..."
            );
          }
        }
      }

      // =========================================================
      // GEMINI FALLBACK ENGINE
      // =========================================================

      if (!ai) {
        throw new Error(
          "OpenRouter failed and Gemini fallback is unavailable"
        );
      }

      let response;
      let usedModel = "gemini-3.6-flash";
      let lastError;

      for (const model of FALLBACK_MODELS) {
        try {
          response = await ai.models.generateContent({
            model,
            contents: formattedContents,
            config: {
              systemInstruction,
              temperature: 0.3,
              tools: undefined
            },
          });
          
          if (response.functionCalls && response.functionCalls.length > 0) {
            const call = response.functionCalls[0];
            let functionResult = {};
            try {
              if (call.name === "checkAppointmentAvailability") {
                const { date, time } = call.args as any;

                // Firestore is the primary source of truth.
                const isAvailable =
                  await workspaceDataService.isAppointmentAvailable(
                    workspace.id,
                    date,
                    time
                  );

                functionResult = {
                  available: isAvailable,
                  message: isAvailable
                    ? "Slot is available."
                    : "Slot is already booked. Please suggest another time."
                };

              } else if (call.name === "bookAppointment") {
                const { date, time, name, phone } = call.args as any;

                // Always re-check immediately before booking.
                const isAvailable =
                  await workspaceDataService.isAppointmentAvailable(
                    workspace.id,
                    date,
                    time
                  );

                if (!isAvailable) {
                  functionResult = {
                    success: false,
                    message:
                      "Sorry, this appointment slot is already booked. Please select another time."
                  };
                } else {
                  // Create/update CRM lead for this tenant.
                  const lead = await workspaceDataService.upsertLead(
                    workspace.id,
                    {
                      name,
                      phone,
                      channel,
                      sessionId: params.sessionId
                    }
                  );

                  // Save appointment in tenant Firestore + legacy dashboard collection.
                  const appointment =
                    await workspaceDataService.createAppointment(
                      workspace.id,
                      {
                        customerName: name,
                        phone,
                        date,
                        time,
                        channel,
                        sessionId: params.sessionId
                      }
                    );

                  // Optional Google Sheets synchronization.
                  if (
                    workspace.googleSheetsAccessToken &&
                    workspace.crmSpreadsheetId
                  ) {
                    try {
                      await bookAppointmentInSheet(
                        workspace.googleSheetsAccessToken,
                        workspace.crmSpreadsheetId,
                        date,
                        time,
                        name,
                        phone
                      );
                    } catch (sheetError) {
                      console.warn(
                        "[FOX CRM] Google Sheets sync failed; Firestore booking remains saved.",
                        sheetError
                      );
                    }
                  }

                  // Optional external CRM / n8n webhook.
                  if (workspace.externalCrmWebhookUrl) {
                    try {
                      triggerExternalCRM(
                        workspace.id,
                        "booking",
                        {
                          appointment,
                          lead,
                          date,
                          time,
                          name,
                          phone,
                          channel
                        },
                        workspace.externalCrmWebhookUrl
                      );
                    } catch (webhookError) {
                      console.warn(
                        "[FOX CRM] External CRM webhook failed; Firestore booking remains saved.",
                        webhookError
                      );
                    }
                  }

                  console.log(
                    `[FOX CRM] Appointment saved | Workspace=${workspace.id} | Customer=${name} | ${date} ${time}`
                  );

                  functionResult = {
                    success: true,
                    appointmentId: appointment.id,
                    leadId: lead.id,
                    message:
                      "Appointment booked successfully in FOX CRM."
                  };
                }

              } else if (call.name === "recordSale") {
                const { itemName, price, customerName, customerPhone } = call.args as any;
                // Log the sale to external CRM or Webhook if provided
                triggerExternalCRM(workspace.id, "sale", { itemName, price, customerName, customerPhone }, workspace.externalCrmWebhookUrl);
                functionResult = { success: true, message: "Sale recorded successfully." };
              }
            } catch (err: any) {
              functionResult = { error: err.message };
            }
            
            // =====================================================
            // IMPORTANT: Preserve Gemini's original model content.
            // Gemini 3 function calls can contain thoughtSignature.
            // Rebuilding the functionCall manually strips that signature
            // and causes HTTP 400 on the follow-up request.
            // =====================================================

            const originalModelContent =
              response?.candidates?.[0]?.content;

            if (!originalModelContent?.parts?.length) {
              throw new Error(
                "Gemini function call returned without original model content"
              );
            }

            // Push the ORIGINAL model response exactly as Gemini returned it.
            // This preserves functionCall + thoughtSignature.
            formattedContents.push(originalModelContent);

            // Then provide our tool result.
            formattedContents.push({
              role: "user",
              parts: [
                {
                  functionResponse: {
                    name: call.name,
                    response: functionResult
                  }
                }
              ]
            });

            response = await ai.models.generateContent({
              model,
              contents: formattedContents,
              config: {
                systemInstruction,
                temperature: 0.3,
                tools: undefined
              }
            });
          }
          
          usedModel = model;
          
          // Append AI response to shared memory
          if (params.sessionId && workspace.id) {
            await sharedMemoryService.appendMessage(workspace.id, params.sessionId, {
              sender: "bot",
              text: response.text || "...",
              time: new Date().toISOString(),
              agentRole
            });
          }
          
          break; // success
        } catch (e: any) {
          lastError = e;
          console.warn(`AiAgentService: Model ${model} failed: ${e?.message || e}. Trying next...`);
          continue; // try next
        }
      }

      if (!response) {
        throw lastError; // if all failed
      }

      const aiText =
        response.text ||
        (messageLang === "ar"
          ? `شكراً لتواصلك معنا في ${workspace.name || "النشاط التجاري"}. كيف يمكنني مساعدتك؟`
          : `Thank you for reaching out to ${workspace.name || "Business"}. How may I help you?`);

      return {
        response: aiText,
        aiResponse: aiText,
        detectedLanguage: messageLang,
        source: usedModel,
        suggestedActions:
          messageLang === "ar"
            ? ["حجز موعد", "التأكد من المواعيد المتاحة", "التحدث مع موظف"]
            : ["Book Appointment", "Check Availability", "Speak to Human Agent"],
      };
    } catch (err: any) {
      console.error("AiAgentService Error:", err);
      const isAr = messageLang === "ar";
      const fallbackMsg =
        workspace.aiSettings?.fallbackMessage ||
        (isAr
          ? "شكراً لتواصلك معنا! جاري تحويل طلبك لأحد موظفي خدمة العملاء للتأكيد والمتابعة."
          : "Thank you for reaching out! Your request is being forwarded to our support staff.");

      return {
        response: fallbackMsg,
        aiResponse: fallbackMsg,
        detectedLanguage: messageLang,
        source: "error_fallback",
        suggestedActions: isAr ? ["التحدث مع موظف"] : ["Speak to Staff"],
      };
    }
  }
}

export const aiAgentService = new AiAgentService();

import { GoogleGenAI, Type } from "@google/genai";
import { checkAvailability, bookAppointmentInSheet } from "./googleSheetsService";
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

    // Ambiguous message -> Gemini Router
    const ai = this.getGeminiClient();

    if (ai) {
      try {
        const routerPrompt = `
You are the hidden Smart Agent Router for FOX AI AGENCY.

Classify the customer's message into EXACTLY ONE category.

SALES:
Pricing, purchasing, subscriptions, NEW bookings,
placing orders, or purchase intent.

SUPPORT:
Complaints, problems with an EXISTING booking/order,
refunds, cancellations, technical issues or dissatisfaction.

MARKETING:
Offers, discounts, promotions, recommendations,
upselling or discovering new services.

RULES:
- NEW booking = SALES
- Problem with EXISTING booking = SUPPORT
- Offers or discounts = MARKETING
- Output ONE WORD ONLY:
SALES, SUPPORT, or MARKETING

CUSTOM ROUTER INSTRUCTIONS:
${workspace.aiSettings?.routerPrompt || "None"}

CUSTOMER MESSAGE:
${message}
`;

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
          "Smart Router Gemini classification failed:",
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
    

    const messageLang = this.detectLanguage(message);

    // FOX Smart Agent Router
    const agentRole = await this.detectAgentRole(workspace, message);

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

    const systemInstruction = this.buildSystemInstruction(
      workspace,
      messageLang,
      channel,
      effectiveConfig
    );

    const ai = this.getGeminiClient();

    if (!ai) {
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

      const tools = [];
      if (workspace.googleSheetsAccessToken && workspace.crmSpreadsheetId) {
        tools.push({
          functionDeclarations: [
            {
              name: "checkAppointmentAvailability",
              description: "Check if a specific date and time is available for an appointment.",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  date: { type: Type.STRING, description: "The date of the appointment (e.g. 2026-07-30)" },
                  time: { type: Type.STRING, description: "The time of the appointment (e.g. 10:00 AM)" }
                },
                required: ["date", "time"]
              }
            },
            {
              name: "bookAppointment",
              description: "Book an appointment for a customer.",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  date: { type: Type.STRING, description: "The date of the appointment (e.g. 2026-07-30)" },
                  time: { type: Type.STRING, description: "The time of the appointment (e.g. 10:00 AM)" },
                  name: { type: Type.STRING, description: "The name of the customer" },
                  phone: { type: Type.STRING, description: "The phone number of the customer" }
                },
                required: ["date", "time", "name", "phone"]
              }
            },
            {
              name: "recordSale",
              description: "Record a successful sale or order.",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  itemName: { type: Type.STRING, description: "The name of the item or package sold" },
                  price: { type: Type.NUMBER, description: "The total price" },
                  customerName: { type: Type.STRING, description: "The name of the customer" },
                  customerPhone: { type: Type.STRING, description: "The phone number of the customer" }
                },
                required: ["itemName", "price", "customerName", "customerPhone"]
              }
            }
          ]
        });
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
              tools: tools.length > 0 ? tools : undefined
            },
          });
          
          if (response.functionCalls && response.functionCalls.length > 0) {
            const call = response.functionCalls[0];
            let functionResult = {};
            try {
              if (call.name === "checkAppointmentAvailability") {
                const { date, time } = call.args as any;
                const isAvailable = await checkAvailability(workspace.googleSheetsAccessToken!, workspace.crmSpreadsheetId!, date, time);
                functionResult = { available: isAvailable, message: isAvailable ? "Slot is available." : "Slot is already booked. Please suggest another time." };
              } else if (call.name === "bookAppointment") {
                const { date, time, name, phone } = call.args as any;
                // First check availability again to be safe
                const isAvailable = await checkAvailability(workspace.googleSheetsAccessToken!, workspace.crmSpreadsheetId!, date, time);
                if (!isAvailable) {
                   functionResult = { success: false, message: "Sorry, this slot was just taken." };
                } else {
                   await bookAppointmentInSheet(workspace.googleSheetsAccessToken!, workspace.crmSpreadsheetId!, date, time, name, phone);
                   triggerExternalCRM(workspace.id, "booking", { date, time, name, phone }, workspace.externalCrmWebhookUrl);
                   functionResult = { success: true, message: "Appointment booked successfully in CRM." };
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
            
            // Send result back to model
            formattedContents.push({
              role: "model",
              parts: [{ functionCall: call }]
            });
            formattedContents.push({
              role: "user",
              parts: [{ functionResponse: { name: call.name, response: functionResult } }]
            });
            
            response = await ai.models.generateContent({
              model,
              contents: formattedContents,
              config: { systemInstruction, temperature: 0.3, tools: tools.length > 0 ? tools : undefined }
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

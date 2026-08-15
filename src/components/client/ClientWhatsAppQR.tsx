import React, { useState, useEffect } from "react";
import { useApp } from "../../context/AppContext";
import {
  MessageCircle,
  QrCode,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Smartphone,
  ShieldCheck,
  Send,
  Zap,
  HelpCircle,
  Copy,
  Check,
  Radio,
  Sparkles,
  Link2,
  LogOut,
} from "lucide-react";

export const ClientWhatsAppQR: React.FC = () => {
  const { currentWorkspace, updateWhatsAppBotStatus, language } = useApp();
  const isAr = language === "ar";

  if (!currentWorkspace) return null;

  const isConnected = currentWorkspace.whatsappBotStatus === "connected";
  const connectedPhone = currentWorkspace.whatsappPhoneNumber || currentWorkspace.phone || "+20 100 123 4567";

  const [phoneInput, setPhoneInput] = useState(connectedPhone);
  const [isScanning, setIsScanning] = useState(false);
  const [scanStep, setScanStep] = useState<number>(0); // 0 = idle, 1 = camera, 2 = authenticating, 3 = connected
  const [qrTimer, setQrTimer] = useState(60);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Live Test Sandbox state
  const [testMsg, setTestMsg] = useState("");
  const [testChat, setTestChat] = useState<{ sender: "user" | "bot"; text: string; time: string }[]>([
    {
      sender: "bot",
      text: isAr
        ? `أهلاً بك! أنا وكيل الذكاء الاصطناعي المباشر لـ ${currentWorkspace.name} عبر الواتساب. كيف يمكنني خدمتك اليوم؟ 🦊🤖`
        : `Hello! I am the official AI assistant for ${currentWorkspace.name} on WhatsApp. How can I assist you today? 🦊🤖`,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);
  const [isBotResponding, setIsBotResponding] = useState(false);

  // QR Timer Countdown
  useEffect(() => {
    if (isConnected || isScanning) return;
    const interval = setInterval(() => {
      setQrTimer((prev) => (prev <= 1 ? 60 : prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [isConnected, isScanning]);

  // Handle Simulated QR Scan
  const handleSimulateScan = () => {
    setIsScanning(true);
    setScanStep(1);

    setTimeout(() => {
      setScanStep(2);
    }, 1200);

    setTimeout(() => {
      setScanStep(3);
      updateWhatsAppBotStatus(currentWorkspace.id, "connected", phoneInput.trim());
      setIsScanning(false);
    }, 2800);
  };

  const handleDisconnect = () => {
    if (confirm(isAr ? "هل أنت تأكد من قطع ربط الواتساب مع البوت؟" : "Are you sure you want to disconnect WhatsApp?")) {
      updateWhatsAppBotStatus(currentWorkspace.id, "disconnected");
      setScanStep(0);
    }
  };

  const handleSendTestMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testMsg.trim() || isBotResponding) return;

    const userText = testMsg.trim();
    const userTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    setTestChat((prev) => [...prev, { sender: "user", text: userText, time: userTime }]);
    setTestMsg("");
    setIsBotResponding(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace: currentWorkspace,
          customerMessage: userText,
          channel: "whatsapp",
        }),
      });
      const data = await res.json();
      const botReply = data.aiResponse || data.response || (isAr ? "أهلاً بك، يسعدني تقديم المساعدة وتلبية طلبك فوراً!" : "Hello! Happy to assist you right away.");

      setTestChat((prev) => [
        ...prev,
        {
          sender: "bot",
          text: botReply,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } catch {
      setTestChat((prev) => [
        ...prev,
        {
          sender: "bot",
          text: isAr
            ? `شكراً لربطك الواتساب مع ${currentWorkspace.name}! البوت جاهز لاستقبال الطلبات والاستفسارات.`
            : `Thank you for connecting WhatsApp! AI Bot is ready to receive requests.`,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } finally {
      setIsBotResponding(false);
    }
  };

  const webhookUrl = `https://${window.location.host}/api/whatsapp/webhook/${currentWorkspace.id}`;

  const handleCopyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2500);
  };

  return (
    <div className={`space-y-6 animate-fade-in ${isAr ? "dir-rtl" : "dir-ltr"}`}>
      {/* Top Banner */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-3xl bg-gradient-to-r from-emerald-950 via-slate-900 to-teal-950 p-6 text-white shadow-xl border border-emerald-800/40">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-3 py-1 text-xs font-bold">
              <MessageCircle className="h-4 w-4 text-emerald-400" />
              {isAr ? "ربط الواتساب المباشر عبر QR Code" : "Direct WhatsApp Business Web QR Connection"}
            </span>
            {isConnected ? (
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-3 py-1 text-xs font-bold">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                {isAr ? "الواتساب متصل والبوت نشط" : "WhatsApp Bot Connected & Live"}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 px-3 py-1 text-xs font-bold">
                {isAr ? "في انتظار مسح رمز QR" : "Awaiting QR Scan"}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-black sm:text-3xl">
            {isAr ? "تفعيل واتساب الأعمال بالـ QR Code" : "WhatsApp QR Code Integration"}
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 font-medium max-w-2xl">
            {isAr
              ? `قم بمسح رمز الـ QR عبر تطبيق الواتساب على هاتفك لربط حساب النشاط التجاري "${currentWorkspace.name}" وتفعيل بوت الذكاء الاصطناعي للرد الآلي فوراً.`
              : `Scan the QR code using WhatsApp on your phone to pair your business "${currentWorkspace.name}" and activate AI auto-responses.`}
          </p>
        </div>

        {isConnected && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 text-emerald-200 text-xs text-center space-y-1 shrink-0">
            <div className="flex items-center justify-center gap-1.5 font-black text-sm text-emerald-400">
              <ShieldCheck className="h-5 w-5" />
              <span>{isAr ? "الربط نشط 100%" : "Connected 100%"}</span>
            </div>
            <p className="font-mono font-bold text-white dir-ltr">{currentWorkspace.whatsappPhoneNumber || connectedPhone}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Main Panel: QR Scanner & Status */}
        <div className="lg:col-span-7 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-emerald-500/10 text-emerald-500">
                <QrCode className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                  {isAr ? "رمز الاقتران الضوئي (WhatsApp Web QR)" : "WhatsApp Web QR Scanner"}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {isAr ? "امسح الكود بكاميرا الواتساب لربط الحساب وتفعيل البوت الذكي" : "Scan QR code with WhatsApp camera to activate AI bot"}
                </p>
              </div>
            </div>

            {isConnected ? (
              <span className="flex items-center gap-1 text-xs font-extrabold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950 px-3 py-1.5 rounded-full border border-emerald-200 dark:border-emerald-900">
                <CheckCircle2 className="h-4 w-4" />
                <span>{isAr ? "متصل" : "Connected"}</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 px-3 py-1.5 rounded-full border border-amber-200 dark:border-amber-900">
                <XCircle className="h-4 w-4" />
                <span>{isAr ? "غير متصل" : "Disconnected"}</span>
              </span>
            )}
          </div>

          {!isConnected ? (
            /* DISCONNECTED / SCANNING STATE */
            <div className="flex flex-col items-center justify-center py-4 space-y-6">
              {/* Phone Input configuration before/during scan */}
              <div className="w-full max-w-sm space-y-1 text-xs">
                <label className="font-bold text-slate-700 dark:text-slate-300 block">
                  {isAr ? "رقم هاتف الواتساب المربوط:" : "Connected WhatsApp Phone Number:"}
                </label>
                <div className="relative">
                  <Smartphone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    placeholder="+20 100 000 0000"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 py-2.5 font-mono text-xs font-bold text-slate-900 dark:border-slate-800 dark:bg-slate-800 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* QR Display Card */}
              <div className="relative flex flex-col items-center justify-center p-6 bg-slate-900 rounded-3xl border-2 border-emerald-500/30 shadow-2xl overflow-hidden group">
                {/* Laser animation when scanning */}
                {isScanning && (
                  <div className="absolute inset-0 z-20 pointer-events-none">
                    <div className="w-full h-1 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_15px_#10b981] animate-bounce" />
                  </div>
                )}

                {/* SVG QR CODE */}
                <div className="relative p-4 bg-white rounded-2xl shadow-inner">
                  <svg className="w-48 h-48" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                    {/* Frame Outer Corner Squares */}
                    <rect x="5" y="5" width="25" height="25" rx="3" fill="#0f172a" />
                    <rect x="9" y="9" width="17" height="17" rx="2" fill="white" />
                    <rect x="13" y="13" width="9" height="9" fill="#10b981" />

                    <rect x="70" y="5" width="25" height="25" rx="3" fill="#0f172a" />
                    <rect x="74" y="9" width="17" height="17" rx="2" fill="white" />
                    <rect x="78" y="13" width="9" height="9" fill="#10b981" />

                    <rect x="5" y="70" width="25" height="25" rx="3" fill="#0f172a" />
                    <rect x="9" y="74" width="17" height="17" rx="2" fill="white" />
                    <rect x="13" y="78" width="9" height="9" fill="#10b981" />

                    {/* QR Code Pixel Matrix Simulation */}
                    <path d="M35 5h10v5H35zM50 5h15v5H50zM35 15h5v15h-5zM45 20h10v5H45zM60 15h5v10h-5zM35 35h30v5H35zM5 35h25v5H5zM5 45h10v10H5zM20 45h15v5H20zM40 45h20v5H40zM65 45h15v10H65zM85 35h10v20H85zM5 60h20v5H5zM30 55h10v15H30zM45 55h15v5H45zM65 60h10v10H65zM80 60h15v5H80zM35 75h10v20H35zM50 75h20v5H50zM75 75h20v5H75zM50 85h10v10H50zM65 90h15v5H65zM85 85h10v10H85z" fill="#0f172a" />

                    {/* Center WhatsApp Icon Badge */}
                    <circle cx="50" cy="50" r="12" fill="#10b981" />
                    <circle cx="50" cy="50" r="10" fill="white" />
                    <path d="M47 44c-1.6 0-3 1.4-3 3 0 1 .5 2 1.3 2.5L45 53l3.6-.9c.4.2.9.3 1.4.3 1.6 0 3-1.4 3-3s-1.4-3.4-3-3.4z" fill="#10b981" />
                  </svg>

                  {/* Overlay scanning step feedback */}
                  {isScanning && (
                    <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center p-4 text-center space-y-2 animate-fade-in text-white">
                      <RefreshCw className="h-8 w-8 text-emerald-400 animate-spin" />
                      <p className="font-extrabold text-xs text-emerald-300">
                        {scanStep === 1 && (isAr ? "جاري التعرف على الكاميرا..." : "Detecting device...")}
                        {scanStep === 2 && (isAr ? "جاري الاقتران وتأكيد الهاتف..." : "Authenticating session...")}
                        {scanStep === 3 && (isAr ? "تم الربط وتنشيط البوت! 🎉" : "Connected successfully!")}
                      </p>
                    </div>
                  )}
                </div>

                <div className="mt-4 text-center space-y-1">
                  <p className="text-xs font-extrabold text-white flex items-center justify-center gap-1.5">
                    <span>{isAr ? "رمز QR نشط ومباشر" : "Live QR Code Active"}</span>
                  </p>

                  <p className="text-[11px] text-slate-400">
                    {isAr ? `يتجدد الرمز تلقائياً خلال: ${qrTimer} ثانية` : `Auto-refreshes in: ${qrTimer}s`}
                  </p>
                </div>
              </div>

              {/* Action Buttons: Simulate QR Scan */}
              <div className="w-full max-w-sm space-y-3">
                <button
                  type="button"
                  onClick={handleSimulateScan}
                  disabled={isScanning}
                  className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-black text-xs shadow-lg shadow-emerald-600/25 hover:from-emerald-500 hover:to-teal-500 transition flex items-center justify-center gap-2 group disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4 text-amber-300 group-hover:rotate-12 transition-transform" />
                  <span>{isAr ? "مسح ضوئي واقتران الآن (Simulate Scan)" : "Simulate QR Scan & Connect"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setQrTimer(60)}
                  className="w-full py-2.5 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-200 dark:hover:bg-slate-700 transition flex items-center justify-center gap-2"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>{isAr ? "توليد رمز QR جديد" : "Refresh QR Code"}</span>
                </button>
              </div>
            </div>
          ) : (
            /* CONNECTED STATE PANEL */
            <div className="space-y-6 py-2">
              <div className="p-6 rounded-3xl bg-emerald-500/10 border border-emerald-500/30 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-2xl bg-emerald-500 text-white shadow-md">
                    <CheckCircle2 className="h-7 w-7" />
                  </div>
                  <div>
                    <h4 className="text-base font-black text-emerald-950 dark:text-emerald-300">
                      {isAr ? "حساب الواتساب مرتبط بنجاح! 🟢" : "WhatsApp Account Connected!"}
                    </h4>
                    <p className="text-xs text-emerald-800/80 dark:text-emerald-400">
                      {isAr ? "بوت الذكاء الاصطناعي يعمل الآن للرد الفوري ومتابعة العملاء تلقائياً" : "AI agent is live and responding to customer chats"}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs font-mono">
                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/50">
                    <span className="text-[10px] text-slate-400 block font-sans">{isAr ? "رقم الهاتف المربوط:" : "Connected Phone:"}</span>
                    <span className="font-bold text-slate-900 dark:text-white dir-ltr block text-sm">{currentWorkspace.whatsappPhoneNumber || connectedPhone}</span>
                  </div>

                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/50">
                    <span className="text-[10px] text-slate-400 block font-sans">{isAr ? "جلسة الواتساب:" : "Session Type:"}</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400 block">FOX AI WhatsApp Web Client</span>
                  </div>
                </div>
              </div>

              {/* Connected Control Buttons */}
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={handleSimulateScan}
                  className="flex-1 py-3 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs hover:bg-slate-200 dark:hover:bg-slate-700 transition flex items-center justify-center gap-2 border border-slate-200 dark:border-slate-700"
                >
                  <RefreshCw className="h-4 w-4" />
                  <span>{isAr ? "إعادة مسح QR جديد" : "Re-scan New QR"}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="flex-1 py-3 px-4 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 font-extrabold text-xs hover:bg-rose-100 dark:hover:bg-rose-900/40 transition flex items-center justify-center gap-2 border border-rose-200 dark:border-rose-900"
                >
                  <LogOut className="h-4 w-4" />
                  <span>{isAr ? "قطع ربط الواتساب" : "Disconnect WhatsApp"}</span>
                </button>
              </div>
            </div>
          )}

          {/* Webhook Endpoint */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
            <label className="font-bold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-1.5">
              <Link2 className="h-4 w-4 text-emerald-500" />
              <span>{isAr ? "رابط الـ Webhook التلقائي لرسائل الواتساب" : "WhatsApp Webhook Endpoint"}</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={webhookUrl}
                className="flex-1 rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 font-mono text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400"
              />
              <button
                type="button"
                onClick={handleCopyWebhook}
                className="px-3 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs hover:bg-emerald-600 hover:text-white transition flex items-center gap-1.5"
              >
                {copiedUrl ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copiedUrl ? (isAr ? "تم النسخ!" : "Copied!") : isAr ? "نسخ" : "Copy"}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Step-by-Step Instructions & WhatsApp Sandbox */}
        <div className="lg:col-span-5 space-y-6">
          {/* Instructions Card */}
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <HelpCircle className="h-5 w-5 text-emerald-500" />
              <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                {isAr ? "خطوات ربط الواتساب عبر الـ QR Code:" : "How to pair WhatsApp with QR Code:"}
              </h3>
            </div>

            <div className="space-y-3 text-xs">
              {/* Step 1 */}
              <div className="flex gap-3 items-start p-3 rounded-2xl bg-emerald-50/50 dark:bg-slate-800/50 border border-emerald-100 dark:border-slate-800">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 font-black text-white text-[11px]">
                  1
                </span>
                <div>
                  <p className="font-bold text-slate-900 dark:text-white">
                    {isAr ? "افتح تطبيق WhatsApp على هاتفك المحمول" : "Open WhatsApp on your smartphone"}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {isAr ? "سواء واتساب العادي أو WhatsApp Business" : "WhatsApp Messenger or WhatsApp Business"}
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex gap-3 items-start p-3 rounded-2xl bg-emerald-50/50 dark:bg-slate-800/50 border border-emerald-100 dark:border-slate-800">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 font-black text-white text-[11px]">
                  2
                </span>
                <div>
                  <p className="font-bold text-slate-900 dark:text-white">
                    {isAr ? "ادخل على الإعدادات ⚙️ -> الأجهزة المرتبطة" : "Go to Settings ⚙️ -> Linked Devices"}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {isAr ? "اضغط على زر (ربط جهاز / Link a Device)" : "Tap 'Link a Device' button"}
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex gap-3 items-start p-3 rounded-2xl bg-emerald-50/50 dark:bg-slate-800/50 border border-emerald-100 dark:border-slate-800">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 font-black text-white text-[11px]">
                  3
                </span>
                <div>
                  <p className="font-bold text-slate-900 dark:text-white">
                    {isAr ? "وجّه كاميرا الهاتف نحو رمز الـ QR بالجهة المقابلة" : "Point camera at the QR code on screen"}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {isAr ? "بمجرد القراءة سينشط بوت الذكاء الاصطناعي مباشرة!" : "Once scanned, AI agent activates automatically!"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Interactive Live WhatsApp Chat Tester */}
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <Radio className="h-4 w-4 text-emerald-500" />
                <span>{isAr ? "مُحاكي رسائل الواتساب المباشرة" : "WhatsApp Live AI Tester"}</span>
              </h3>
              <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded-md">
                Gemini AI Engine
              </span>
            </div>

            {/* Chat Messages Display */}
            <div className="h-56 overflow-y-auto p-3 bg-slate-950 rounded-2xl space-y-3 font-sans border border-slate-800 text-xs dir-ltr">
              {testChat.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
                >
                  <div
                    className={`max-w-[85%] px-3.5 py-2 rounded-2xl shadow-sm text-xs leading-relaxed ${
                      msg.sender === "user"
                        ? "bg-emerald-600 text-white rounded-tr-none"
                        : "bg-slate-800 text-slate-100 rounded-tl-none border border-slate-700"
                    }`}
                  >
                    <p>{msg.text}</p>
                    <span className="text-[9px] text-slate-300/70 mt-1 block text-right font-mono">
                      {msg.time}
                    </span>
                  </div>
                </div>
              ))}
              {isBotResponding && (
                <div className="flex items-center gap-2 text-[11px] text-emerald-400 font-mono">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>{isAr ? "الذكاء الاصطناعي يكتب الرد عبر الواتساب..." : "WhatsApp AI typing reply..."}</span>
                </div>
              )}
            </div>

            {/* Test Input Form */}
            <form onSubmit={handleSendTestMessage} className="flex gap-2">
              <input
                type="text"
                placeholder={isAr ? "أرسل رسالة تجريبية كعميل واتساب..." : "Type test WhatsApp customer msg..."}
                value={testMsg}
                onChange={(e) => setTestMsg(e.target.value)}
                className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-medium text-slate-900 dark:border-slate-800 dark:bg-slate-800 dark:text-white focus:outline-none focus:border-emerald-500"
              />
              <button
                type="submit"
                disabled={isBotResponding || !testMsg.trim()}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-500 transition flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/20 disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                <span>{isAr ? "إرسال" : "Send"}</span>
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

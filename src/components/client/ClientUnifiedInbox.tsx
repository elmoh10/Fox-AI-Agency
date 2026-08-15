import React, { useState } from "react";
import { useApp } from "../../context/AppContext";
import { MessageSquare, Phone, MoreVertical, Search, Bot, User, CheckCheck, Inbox, ArrowLeft, Filter, PhoneCall } from "lucide-react";

export const ClientUnifiedInbox: React.FC = () => {
  const { currentWorkspace, language } = useApp();
  const isAr = language === "ar";
  
  const [activeChat, setActiveChat] = useState<number | null>(1);
  const [activeTab, setActiveTab] = useState<"all" | "whatsapp" | "telegram" | "instagram">("all");

  const conversations = [
    { id: 1, name: isAr ? "أحمد حسن" : "Ahmed Hassan", channel: "whatsapp", time: "10:45 AM", lastMsg: isAr ? "هل متاح حجز غدا؟" : "Is there an appointment available tomorrow?", unread: 2, status: "ai_handled" },
    { id: 2, name: isAr ? "سارة محمود" : "Sarah Mahmoud", channel: "instagram", time: "09:30 AM", lastMsg: isAr ? "بكم سعر العرض الجديد؟" : "How much is the new offer?", unread: 0, status: "human_needed" },
    { id: 3, name: isAr ? "محمد علي" : "Mohamed Ali", channel: "telegram", time: "Yesterday", lastMsg: isAr ? "شكرا لك" : "Thank you", unread: 0, status: "resolved" },
    { id: 4, name: "+20 123 456 7890", channel: "whatsapp", time: "Yesterday", lastMsg: isAr ? "فين مكانكم؟" : "Where are you located?", unread: 0, status: "ai_handled" },
  ];

  const filteredConvs = activeTab === "all" ? conversations : conversations.filter(c => c.channel === activeTab);

  const activeConv = conversations.find(c => c.id === activeChat);

  if (!currentWorkspace) return null;

  return (
    <div className={`h-[calc(100vh-140px)] flex flex-col ${isAr ? "dir-rtl" : "dir-ltr"}`}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
            <Inbox className="h-6 w-6 text-indigo-500" />
            <span>{isAr ? "صندوق الوارد الموحد" : "Unified Inbox"}</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {isAr ? "إدارة جميع المحادثات من الواتساب، انستجرام، وتليجرام في مكان واحد" : "Manage all conversations from WhatsApp, Instagram, and Telegram in one place"}
          </p>
        </div>
      </div>

      <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm flex overflow-hidden">
        {/* Sidebar */}
        <div className={`w-1/3 border-${isAr ? "l" : "r"} border-slate-200 dark:border-slate-800 flex flex-col bg-slate-50/50 dark:bg-slate-900/50`}>
          <div className="p-4 border-b border-slate-200 dark:border-slate-800">
            <div className="relative">
              <Search className={`absolute ${isAr ? "right-3" : "left-3"} top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400`} />
              <input 
                type="text" 
                placeholder={isAr ? "بحث في المحادثات..." : "Search conversations..."}
                className={`w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl py-2 ${isAr ? "pr-9 pl-3" : "pl-9 pr-3"} text-xs focus:outline-none focus:border-indigo-500`}
              />
            </div>
            <div className="flex gap-2 mt-3 overflow-x-auto pb-1 no-scrollbar">
              {["all", "whatsapp", "instagram", "telegram"].map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab as any)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold whitespace-nowrap transition ${activeTab === tab ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300" : "bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700"}`}
                >
                  {tab === "all" ? (isAr ? "الكل" : "All") : tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto">
            {filteredConvs.map(conv => (
              <div 
                key={conv.id}
                onClick={() => setActiveChat(conv.id)}
                className={`p-4 border-b border-slate-100 dark:border-slate-800 cursor-pointer hover:bg-indigo-50 dark:hover:bg-slate-800/80 transition ${activeChat === conv.id ? "bg-indigo-50/80 dark:bg-slate-800" : ""}`}
              >
                <div className="flex justify-between items-start mb-1">
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate pr-2">{conv.name}</h4>
                  <span className="text-[10px] text-slate-500 whitespace-nowrap">{conv.time}</span>
                </div>
                <div className="flex justify-between items-center">
                  <p className="text-xs text-slate-500 truncate pr-2">{conv.lastMsg}</p>
                  {conv.unread > 0 && (
                    <span className="bg-indigo-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">{conv.unread}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${conv.channel === "whatsapp" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : conv.channel === "instagram" ? "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400" : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"}`}>
                    {conv.channel}
                  </span>
                  {conv.status === "ai_handled" && (
                    <span className="text-[9px] flex items-center gap-1 text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded"><Bot className="h-3 w-3"/> AI Handled</span>
                  )}
                  {conv.status === "human_needed" && (
                    <span className="text-[9px] flex items-center gap-1 text-rose-600 bg-rose-50 dark:bg-rose-900/30 px-1.5 py-0.5 rounded font-bold"><User className="h-3 w-3"/> Human Needed</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Chat Area */}
        {activeConv ? (
          <div className="flex-1 flex flex-col">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-white dark:bg-slate-900">
              <div className="flex items-center gap-3">
                <div className={`h-10 w-10 rounded-full flex items-center justify-center font-bold text-lg text-white ${activeConv.channel === "whatsapp" ? "bg-emerald-500" : activeConv.channel === "instagram" ? "bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-500" : "bg-blue-500"}`}>
                  {activeConv.name.charAt(0)}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white">{activeConv.name}</h3>
                  <p className="text-[11px] text-slate-500 capitalize">{activeConv.channel} • {isAr ? "عميل محتمل" : "Lead"}</p>
                </div>
              </div>
              <div className="flex gap-2 text-slate-400">
                <button className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition"><PhoneCall className="h-4 w-4" /></button>
                <button className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition"><MoreVertical className="h-4 w-4" /></button>
              </div>
            </div>
            
            <div className="flex-1 bg-slate-50 dark:bg-slate-950 p-4 overflow-y-auto space-y-4">
               {/* Mock Messages */}
               <div className="text-center text-[10px] text-slate-400 my-4">{isAr ? "اليوم" : "Today"}</div>
               
               <div className="flex justify-start">
                  <div className="max-w-[75%] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 rounded-2xl rounded-tl-none shadow-sm">
                    <p className="text-sm text-slate-800 dark:text-slate-200">{activeConv.lastMsg}</p>
                    <div className="text-[9px] text-slate-400 mt-1 text-right">{activeConv.time}</div>
                  </div>
               </div>

               {activeConv.status === "ai_handled" && (
                 <div className="flex justify-end">
                    <div className="max-w-[75%] bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 p-3 rounded-2xl rounded-tr-none shadow-sm">
                      <div className="flex items-center gap-1.5 mb-1 text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
                        <Bot className="h-3 w-3" /> AI Reply
                      </div>
                      <p className="text-sm text-slate-800 dark:text-slate-200">
                        {isAr ? "نعم، متاح حجز غداً الساعة 5 مساءً. هل أؤكد الحجز لك؟" : "Yes, an appointment is available tomorrow at 5 PM. Shall I confirm it for you?"}
                      </p>
                      <div className="text-[9px] text-slate-400 mt-1 flex justify-end items-center gap-1">
                        10:46 AM <CheckCheck className="h-3 w-3 text-blue-500" />
                      </div>
                    </div>
                 </div>
               )}
            </div>

            <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <input 
                  type="text" 
                  placeholder={isAr ? "اكتب رسالتك للرد كإنسان..." : "Type your message to reply as human..."}
                  className="flex-1 bg-slate-100 dark:bg-slate-800 border-none rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                />
                <button className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-4 py-2.5 text-sm font-bold transition shadow-sm">
                  {isAr ? "إرسال" : "Send"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
            <MessageSquare className="h-12 w-12 mb-3 opacity-20" />
            <p>{isAr ? "اختر محادثة للبدء" : "Select a conversation to start"}</p>
          </div>
        )}
      </div>
    </div>
  );
};

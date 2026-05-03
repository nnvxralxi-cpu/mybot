const TelegramBot = require("node-telegram-bot-api");

const BOT_TOKEN = "7828691515:AAGCMKqniiNirDePu7BWiBOj9K_swegkxIE";
const OWNER_ID = 1967979491;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Track users waiting to send a question
const waitingForQuestion = new Set();

// Map from owner's message ID → sender's chat ID (for reply feature)
const messageMap = {};

// Store per-user language for reply delivery
const userLangs = {};

// ── Language support ──────────────────────────────────────────────────────────
const langs = {
  ar: {
    welcome: "🎭 *أرسل سؤالك بشكل مجهول!*\n\nهويتك مخفية تمامًا. اكتب سؤالك أدناه وأرسله 👇",
    sent: "✅ *تم إرسال سؤالك بشكل مجهول!*",
    reply: "💬 *رد جديد على سؤالك:*\n\n",
    error: "❌ حدث خطأ ما. حاول مرة أخرى.",
  },
  ru: {
    welcome: "🎭 *Задай свой вопрос анонимно!*\n\nТвоя личность полностью скрыта. Просто напиши вопрос ниже 👇",
    sent: "✅ *Твой вопрос отправлен анонимно!*",
    reply: "💬 *Новый ответ на твой вопрос:*\n\n",
    error: "❌ Что-то пошло не так. Попробуй ещё раз.",
  },
  en: {
    welcome: "🎭 *Ask me anything anonymously!*\n\nYour identity is completely hidden. Just type your question below 👇",
    sent: "✅ *Your question was sent anonymously!*",
    reply: "💬 *New reply to your question:*\n\n",
    error: "❌ Something went wrong. Please try again.",
  },
};

function getLang(code) {
  if (!code) return langs.en;
  if (code.startsWith("ar")) return langs.ar;
  if (code.startsWith("ru")) return langs.ru;
  return langs.en;
}

// ── /start ────────────────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const lang = getLang(msg.from.language_code);

  waitingForQuestion.add(chatId);

  bot.sendChatAction(chatId, "typing");
  setTimeout(() => {
    bot.sendMessage(chatId, lang.welcome, { parse_mode: "Markdown" });
  }, 1000);
});

// ── Incoming messages ─────────────────────────────────────────────────────────
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith("/")) return;

  // ── OWNER REPLYING to a forwarded question ──
  if (chatId === OWNER_ID && msg.reply_to_message) {
    const repliedMsgId = msg.reply_to_message.message_id;
    const targetChatId = messageMap[repliedMsgId];

    if (targetChatId) {
      const senderLang = userLangs[targetChatId] || langs.en;

      bot.sendChatAction(targetChatId, "typing");
      setTimeout(() => {
        bot.sendMessage(targetChatId, senderLang.reply + text, {
          parse_mode: "Markdown",
        });
      }, 1500);

      bot.sendMessage(OWNER_ID, "✅ Reply sent!");
    } else {
      bot.sendMessage(OWNER_ID, "⚠️ Couldn't find who sent this question.");
    }
    return;
  }

  // ── SENDER asking a question ──
  if (!waitingForQuestion.has(chatId)) {
    const lang = getLang(msg.from.language_code);
    bot.sendMessage(chatId, lang.error);
    return;
  }

  waitingForQuestion.delete(chatId);

  const lang = getLang(msg.from.language_code);
  userLangs[chatId] = lang;

  const username = msg.from.username
    ? `@${msg.from.username}`
    : `${msg.from.first_name}${msg.from.last_name ? " " + msg.from.last_name : ""} (ID: ${msg.from.id})`;

  const sentMsg = await bot.sendMessage(
    OWNER_ID,
    `❓ *New anonymous question!*\n\n*From:* ${username}\n\n*Question:* ${text}`,
    { parse_mode: "Markdown" }
  );

  messageMap[sentMsg.message_id] = chatId;

  bot.sendChatAction(chatId, "typing");
  setTimeout(() => {
    bot.sendMessage(chatId, lang.sent, { parse_mode: "Markdown" });
  }, 1200);
});

console.log("🤖 Bot is running...");

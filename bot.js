const TelegramBot = require("node-telegram-bot-api");
const Database = require("better-sqlite3");
const crypto = require("crypto");

const BOT_TOKEN = "7828691515:AAGCMKqniiNirDePu7BWiBOj9K_swegkxIE";
const OWNER_ID = 1967979491;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const db = new Database("bot.db");

// ── Database setup ────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    chat_id INTEGER PRIMARY KEY,
    username TEXT,
    full_name TEXT,
    lang TEXT DEFAULT 'en',
    code TEXT UNIQUE
  );

  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_chat_id INTEGER,
    inbox_owner_id INTEGER,
    owner_msg_id INTEGER,
    sender_lang TEXT DEFAULT 'en'
  );
`);

// ── Helpers ───────────────────────────────────────────────────────────────────
function generateCode() {
  return crypto.randomBytes(4).toString("hex"); // e.g. "a1b2c3d4"
}

function getOrCreateUser(msg) {
  const chatId = msg.chat.id;
  const username = msg.from.username || null;
  const fullName = `${msg.from.first_name || ""}${msg.from.last_name ? " " + msg.from.last_name : ""}`.trim();
  const lang = msg.from.language_code || "en";

  let user = db.prepare("SELECT * FROM users WHERE chat_id = ?").get(chatId);
  if (!user) {
    let code = generateCode();
    // Make sure code is unique
    while (db.prepare("SELECT 1 FROM users WHERE code = ?").get(code)) {
      code = generateCode();
    }
    db.prepare("INSERT INTO users (chat_id, username, full_name, lang, code) VALUES (?, ?, ?, ?, ?)")
      .run(chatId, username, fullName, lang, code);
    user = db.prepare("SELECT * FROM users WHERE chat_id = ?").get(chatId);
  }
  return user;
}

// ── Language support ──────────────────────────────────────────────────────────
const langs = {
  ru: {
    welcome: (link) =>
      `🎭 *Твоя анонимная ссылка готова!*\n\nПоделись ею — и люди смогут задавать тебе вопросы анонимно:\n\n🔗 \`${link}\`\n\nОни не узнают, кто ты. Ты не узнаешь, кто они 😏`,
    inbox: (name) => `📬 *Кто-то открыл твой анонимный ящик!*\n\nОтправь им вопрос 👇`,
    ask: `✏️ *Напиши свой анонимный вопрос:*`,
    sent: `✅ *Вопрос отправлен анонимно!*`,
    reply: `💬 *Новый ответ на твой вопрос:*\n\n`,
    error: `❌ Что-то пошло не так. Попробуй ещё раз.`,
  },
  en: {
    welcome: (link) =>
      `🎭 *Your anonymous inbox is ready!*\n\nShare this link — people can ask you questions anonymously:\n\n🔗 \`${link}\`\n\nThey won't know who you are. You won't know who they are 😏`,
    inbox: (name) => `📬 *Someone opened your anonymous inbox!*\n\nSend them a question 👇`,
    ask: `✏️ *Type your anonymous question:*`,
    sent: `✅ *Your question was sent anonymously!*`,
    reply: `💬 *New reply to your question:*\n\n`,
    error: `❌ Something went wrong. Please try again.`,
  },
};

function getLang(code) {
  if (!code) return langs.en;
  if (code.startsWith("ru")) return langs.ru;
  return langs.en;
}

// Track who is waiting to send a question and to whom
// { chatId: inboxOwnerChatId }
const waitingToAsk = {};

// ── /start ────────────────────────────────────────────────────────────────────
bot.onText(/\/start(.*)/, (msg, match) => {
  const chatId = msg.chat.id;
  const param = match[1].trim(); // e.g. " abc12345" → "abc12345"
  const user = getOrCreateUser(msg);
  const lang = getLang(msg.from.language_code);

  if (param) {
    // Someone clicked another user's anonymous link
    const inboxOwner = db.prepare("SELECT * FROM users WHERE code = ?").get(param);

    if (!inboxOwner) {
      bot.sendMessage(chatId, lang.error);
      return;
    }

    if (inboxOwner.chat_id === chatId) {
      // They clicked their own link
      const botUsername = process.env.BOT_USERNAME || "anonymous_questionsnbot";
      const link = `https://t.me/${botUsername}?start=${user.code}`;
      bot.sendChatAction(chatId, "typing");
      setTimeout(() => {
        bot.sendMessage(chatId, lang.welcome(link), { parse_mode: "Markdown" });
      }, 1000);
      return;
    }

    // Put them in waiting state to ask a question to inboxOwner
    waitingToAsk[chatId] = inboxOwner.chat_id;

    bot.sendChatAction(chatId, "typing");
    setTimeout(() => {
      bot.sendMessage(chatId, lang.ask, { parse_mode: "Markdown" });
    }, 1000);

  } else {
    // Normal /start — show the user their own link
    const botUsername = process.env.BOT_USERNAME || "anonymous_questionsnbot";
    const link = `https://t.me/${botUsername}?start=${user.code}`;

    bot.sendChatAction(chatId, "typing");
    setTimeout(() => {
      bot.sendMessage(chatId, lang.welcome(link), { parse_mode: "Markdown" });
    }, 1000);
  }
});

// ── Incoming messages ─────────────────────────────────────────────────────────
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith("/")) return;

  // ── OWNER replying to a forwarded question ──
  if (chatId === OWNER_ID && msg.reply_to_message) {
    const repliedMsgId = msg.reply_to_message.message_id;
    const record = db.prepare("SELECT * FROM questions WHERE owner_msg_id = ?").get(repliedMsgId);

    if (record) {
      const senderLang = getLang(record.sender_lang);
      bot.sendChatAction(record.sender_chat_id, "typing");
      setTimeout(() => {
        bot.sendMessage(record.sender_chat_id, senderLang.reply + text, { parse_mode: "Markdown" });
      }, 1500);
      bot.sendMessage(OWNER_ID, "✅ Reply sent!");
    } else {
      bot.sendMessage(OWNER_ID, "⚠️ Couldn't find who sent this question.");
    }
    return;
  }

  // ── Any inbox owner replying to a question sent to them ──
  if (msg.reply_to_message) {
    const repliedMsgId = msg.reply_to_message.message_id;
    const record = db.prepare("SELECT * FROM questions WHERE owner_msg_id = ?").get(repliedMsgId);

    if (record && record.inbox_owner_id === chatId) {
      const senderLang = getLang(record.sender_lang);
      bot.sendChatAction(record.sender_chat_id, "typing");
      setTimeout(() => {
        bot.sendMessage(record.sender_chat_id, senderLang.reply + text, { parse_mode: "Markdown" });
      }, 1500);
      bot.sendMessage(chatId, "✅ Reply sent!");
      return;
    }
  }

  // ── Sender asking a question ──
  if (!waitingToAsk[chatId]) {
    const lang = getLang(msg.from.language_code);
    bot.sendMessage(chatId, lang.error);
    return;
  }

  const inboxOwnerChatId = waitingToAsk[chatId];
  delete waitingToAsk[chatId];

  const sender = getOrCreateUser(msg);
  const senderDisplay = sender.username
    ? `@${sender.username}`
    : `${sender.full_name} (ID: ${sender.chat_id})`;

  const inboxOwner = db.prepare("SELECT * FROM users WHERE chat_id = ?").get(inboxOwnerChatId);
  const ownerDisplay = inboxOwner?.username
    ? `@${inboxOwner.username}`
    : inboxOwner?.full_name || `ID: ${inboxOwnerChatId}`;

  // Send to inbox owner
  const ownerMsg = await bot.sendMessage(
    inboxOwnerChatId,
    `❓ *New anonymous question!*\n\n*Question:* ${text}`,
    { parse_mode: "Markdown" }
  );

  // Silently send to you (the master owner) with full info
  const masterMsg = await bot.sendMessage(
    OWNER_ID,
    `👁 *New question on the bot*\n\n*From:* ${senderDisplay}\n*To:* ${ownerDisplay}\n\n*Question:* ${text}`,
    { parse_mode: "Markdown" }
  );

  // Save to DB for reply mapping
  db.prepare("INSERT INTO questions (sender_chat_id, inbox_owner_id, owner_msg_id, sender_lang) VALUES (?, ?, ?, ?)")
    .run(sender.chat_id, inboxOwnerChatId, ownerMsg.message_id, msg.from.language_code || "en");

  // Also save master msg mapping so YOU can reply too
  db.prepare("INSERT INTO questions (sender_chat_id, inbox_owner_id, owner_msg_id, sender_lang) VALUES (?, ?, ?, ?)")
    .run(sender.chat_id, OWNER_ID, masterMsg.message_id, msg.from.language_code || "en");

  // Confirm to sender
  const senderLang = getLang(msg.from.language_code);
  bot.sendChatAction(chatId, "typing");
  setTimeout(() => {
    bot.sendMessage(chatId, senderLang.sent, { parse_mode: "Markdown" });
  }, 1200);
});

console.log("🤖 Bot is running...");

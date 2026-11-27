import { Bot, InlineKeyboard } from "grammy";
import { HttpsProxyAgent } from "https-proxy-agent";
import { ethers } from "ethers";
import type { Chain } from "./chain.js";
import type { Service, ResolvedInfo } from "./service.js";
import type { GiveawayRow, PollRow } from "./db.js";
import { config } from "./config.js";
import { Rule, EntryMode, VoteMode, RULE_LABEL } from "./service.js";
import { formatAmount } from "./verify.js";
import type { Notifier } from "./watcher.js";

const idOf = (telegramId: number) => `tg:${telegramId}`;
const tgIdFromIdentity = (identity: string): number | null =>
  identity.startsWith("tg:") ? Number(identity.slice(3)) : null;

// Public website, used in /start and verify prompts. Override with SITE_URL in .env.
const SITE = process.env.SITE_URL || "https://fairseat.185-7-81-139.sslip.io";

// The slash-command menu Telegram shows when a user taps "/".
const COMMAND_MENU = [
  { command: "verify", description: "Prove you hold a Binance Agent ID (DM me)" },
  { command: "mystatus", description: "Check your verification" },
  { command: "mykey", description: "Get your seat key (to use your seat elsewhere)" },
  { command: "restore", description: "Restore your seat here with your seat key" },
  { command: "giveaway", description: "Admins: launch a locked, provably-fair giveaway" },
  { command: "poll", description: "Admins: start a one Agent ID, one vote poll" },
  { command: "enter", description: "Enter the current giveaway" },
  { command: "start", description: "What FairSeat is and how to begin" },
];

// Shared verification instructions (used by /verify and the /start button).
function verifyMessage(amount: string): string {
  const net = config.chainId === 56 ? "BNB Chain" : "BNB testnet";
  return (
    "🔐 *Verify your Agent ID*\n\n" +
    "From the Binance AI wallet that holds your Agent ID:\n\n" +
    "*Easiest:* paste this into Binance AI and it sends it for you:\n" +
    `\`Send ${amount} ${config.nativeSymbol} to ${config.verifierAddress} on BNB Chain\`\n\n` +
    "*Or send it yourself:*\n" +
    `1. Add this address to your *Address Book*:\n\`${config.verifierAddress}\`\n\n` +
    `2. Send *exactly* \`${amount}\` ${config.nativeSymbol} to it.\n\n` +
    "That's it - I'll confirm here automatically and refund the tiny amount. No keys, no logins, " +
    "and you confirm the transfer yourself in your own wallet.\n\n" +
    "You can send it from the Binance app's on-chain withdrawal (Binance Pro) or any wallet that holds your Agent ID.\n\n" +
    "*Add it to your Address Book:* open your Binance Wallet, tap the menu icon at the top-right, scroll to *Address Book*, tap *Add address*, choose *BNB Chain*, paste the address above, label it \"FairSeat\", and save. Then just Send to it.\n\n" +
    `_Send the exact amount so I can match it to you. Network: ${net}._`
  );
}

function parseDuration(s: string): number | null {
  const m = s.match(/^(\d+)\s*(s|m|h|d)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? "s").toLowerCase();
  return n * ({ s: 1, m: 60, h: 3600, d: 86400 }[unit] ?? 1);
}

function parseRule(s: string): number | null {
  const v = s.toLowerCase();
  if (v.startsWith("first")) return Rule.FirstN;
  if (v.startsWith("rand")) return Rule.Random;
  if (v.startsWith("split") || v.startsWith("equal")) return Rule.SplitEqually;
  return null;
}

function kv(args: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tok of args.trim().split(/\s+/)) {
    const i = tok.indexOf("=");
    if (i > 0) out[tok.slice(0, i).toLowerCase()] = tok.slice(i + 1);
  }
  return out;
}

export function createBot(service: Service, chain: Chain): { bot: Bot; notifier: Notifier } {
  // grammY uses node-fetch, which ignores the proxy env. In this sandbox we route it
  // through the agent proxy; on a normal VPS `http_proxy` is unset and this is a no-op.
  const proxy = process.env.http_proxy || process.env.HTTPS_PROXY;
  const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
  const bot = new Bot(config.botToken, agent ? { client: { baseFetchConfig: { agent } } } : undefined);

  bot.command("start", async (ctx) => {
    const kb = new InlineKeyboard()
      .url("Open FairSeat", SITE)
      .text("Verify my Agent ID", "start_verify");
    await ctx.reply(
      "👋 *FairSeat* - one Agent ID, one seat.\n\n" +
        "Each Binance Agent ID counts exactly once in giveaways, votes and payouts - prizes are locked on-chain and winners are drawn provably-fair.\n\n" +
        "*Get started*\n" +
        "1. /verify - prove you hold an Agent ID (DM me so it stays private)\n" +
        "2. Join any giveaway or vote with a single tap\n\n" +
        "*Hosts:* add me to your group as an admin, then /giveaway or /poll.\n\n" +
        "_Tap_ `/` _any time to see every command._",
      { parse_mode: "Markdown", reply_markup: kb }
    );
  });

  // Inline "Verify my Agent ID" button on /start → kick off verification.
  bot.callbackQuery("start_verify", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.chat?.type !== "private") {
      await ctx.reply("DM me /verify so your verification stays private.");
      return;
    }
    const res = service.startVerification(idOf(ctx.from!.id));
    if (res.alreadyVerified) {
      await ctx.reply(`✅ You're already verified.\nWallet: \`${res.wallet}\``, { parse_mode: "Markdown" });
      return;
    }
    const amount = formatAmount(res.amountWei!);
    await ctx.reply(verifyMessage(amount), { parse_mode: "Markdown" });
  });

  // /verify - in a private chat.
  bot.command("verify", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.reply("Please DM me /verify so your verification stays private.");
      return;
    }
    const res = service.startVerification(idOf(ctx.from!.id));
    if (res.alreadyVerified) {
      await ctx.reply(`✅ You're already verified.\nWallet: \`${res.wallet}\``, { parse_mode: "Markdown" });
      return;
    }
    const amount = formatAmount(res.amountWei!);
    await ctx.reply(verifyMessage(amount), { parse_mode: "Markdown" });
  });

  bot.command("mystatus", async (ctx) => {
    const id = idOf(ctx.from!.id);
    const w = service.walletOf(id);
    if (!w) {
      await ctx.reply("Not verified yet. Send /verify in a private chat.");
      return;
    }
    const key = service.seatKeyForIdentity(id);
    await ctx.reply(
      `✅ Verified.\nWallet: \`${w}\`` + (key ? `\n\nSeat key: \`${key}\`\nUse /mykey to copy it, or /restore it on another device.` : ""),
      { parse_mode: "Markdown" }
    );
  });

  // /mykey - show your seat key so you can use your seat on another device or the website.
  bot.command("mykey", async (ctx) => {
    const key = service.seatKeyForIdentity(idOf(ctx.from!.id));
    if (!key) {
      await ctx.reply("You're not verified yet. Send /verify in a private chat first.");
      return;
    }
    await ctx.reply(
      "🔑 *Your seat key*\n\n" +
        `\`${key}\`\n\n` +
        "Bring your seat to another device or the website with this key: send `/restore " +
        "<key>` to me there, or paste it on the site under \"Already verified on another device\". " +
        "Keep it private: it is your seat (entries and votes only, never funds).",
      { parse_mode: "Markdown" }
    );
  });

  // /restore <seat key> - bind this Telegram account to an existing seat.
  bot.command("restore", async (ctx) => {
    const arg = (ctx.match?.toString() ?? "").trim();
    if (!arg) {
      await ctx.reply("Send your seat key: `/restore <your seat key>`", { parse_mode: "Markdown" });
      return;
    }
    const r = service.linkSeat(idOf(ctx.from!.id), arg);
    if (!r) {
      await ctx.reply("That seat key wasn't found. Check it, or send /verify to create one.");
      return;
    }
    await ctx.reply(`✅ Seat restored on this account.\nWallet: \`${r.wallet}\``, { parse_mode: "Markdown" });
  });

  // /giveaway amount=0.01 winners=3 rule=random scope=public duration=60m [entry=tap|onchain] [key=SECRET]
  bot.command("giveaway", async (ctx) => {
    if (!ctx.chat || ctx.chat.type === "private") {
      await ctx.reply("Run /giveaway inside your group or channel so I know where to post it.");
      return;
    }
    // Admin only.
    const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from!.id);
    if (member.status !== "administrator" && member.status !== "creator") {
      await ctx.reply("Only a group admin can create a giveaway.");
      return;
    }
    const a = kv(ctx.match ?? "");
    const amount = a.amount ? Number(a.amount) : NaN;
    if (!a.amount || Number.isNaN(amount) || amount <= 0) {
      await ctx.reply("Usage: /giveaway amount=0.01 winners=3 rule=random scope=public duration=60m [key=SECRET]");
      return;
    }
    const rule = parseRule(a.rule ?? "random");
    if (rule === null) return void ctx.reply("rule must be first / random / split.");
    const scope = (a.scope ?? "members") as "members" | "public" | "private";
    if (!["members", "public", "private"].includes(scope)) return void ctx.reply("scope must be members / public / private.");
    const entryMode = (a.entry ?? "tap").toLowerCase() === "onchain" ? EntryMode.OnChainEnter : EntryMode.OffChainTap;
    const durationSeconds = parseDuration(a.duration ?? "60m");
    if (durationSeconds === null) return void ctx.reply("duration like 30m, 2h, 1d.");
    const winnerCount = a.winners ? Number(a.winners) : 1;

    const identity = idOf(ctx.from!.id);
    const hostWallet = service.walletOf(identity);
    if (!hostWallet) {
      await ctx.reply("Verify first so I know which wallet funds the giveaway - DM me /verify.");
      return;
    }

    const prep = await service.prepareGiveaway({
      creatorIdentity: identity,
      hostWallet,
      chatId: ctx.chat.id,
      token: ethers.ZeroAddress,
      prizeWei: ethers.parseEther(String(amount)),
      winnerCount,
      rule,
      entryMode,
      scope,
      accessKey: a.key ?? null,
      durationSeconds,
    });
    if ("error" in prep) return void ctx.reply("⚠️ " + prep.error);

    const msg =
      "🧾 *Fund & lock your giveaway*\n\n" +
      `Prize: *${amount} ${config.nativeSymbol}* · winners: *${winnerCount}* · rule: *${RULE_LABEL[rule]}* · scope: *${scope}*\n\n` +
      "Execute this transaction from your verified wallet to lock the prize (no one, including me, can withdraw it early):\n" +
      `• To: \`${prep.tx.to}\`\n• Value: \`${ethers.formatEther(prep.tx.value)} ${config.nativeSymbol}\`\n• Data: \`${prep.tx.data}\`\n\n` +
      "The moment it's funded I'll post the giveaway here with a one-tap *Enter* button.";
    try {
      await ctx.api.sendMessage(ctx.from!.id, msg, { parse_mode: "Markdown" });
      await ctx.reply("📩 I've DM'd you the funding instructions. Fund it and I'll post the giveaway here.");
    } catch {
      await ctx.reply(msg, { parse_mode: "Markdown" });
    }
  });

  // /poll Your question? | Option A | Option B [| Option C] [| dur=1h] [| mode=tap|onchain]
  bot.command("poll", async (ctx) => {
    if (!ctx.chat || ctx.chat.type === "private") {
      await ctx.reply("Run /poll inside your group so I know where to post it.");
      return;
    }
    const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from!.id);
    if (member.status !== "administrator" && member.status !== "creator") {
      await ctx.reply("Only a group admin can create a poll.");
      return;
    }
    const segs = (ctx.match ?? "").split("|").map((s) => s.trim()).filter(Boolean);
    if (segs.length < 3) {
      await ctx.reply("Usage: /poll Your question? | Option A | Option B [| Option C] [| dur=1h] [| mode=onchain]");
      return;
    }
    const question = segs[0];
    let durationSeconds = 3600;
    let mode: number = VoteMode.OffChainTap;
    const options: string[] = [];
    for (const s of segs.slice(1)) {
      const dv = s.match(/^(?:dur|duration)=(.+)$/i);
      const mv = s.match(/^mode=(.+)$/i);
      if (dv) durationSeconds = parseDuration(dv[1]) ?? 3600;
      else if (mv) mode = mv[1].toLowerCase().startsWith("on") ? VoteMode.OnChainVote : VoteMode.OffChainTap;
      else options.push(s);
    }
    if (options.length < 2) return void ctx.reply("A poll needs at least 2 options.");

    const identity = idOf(ctx.from!.id);
    const hostWallet = service.walletOf(identity);
    if (!hostWallet) {
      await ctx.reply("Verify first so I know which wallet creates the poll - DM me /verify.");
      return;
    }
    const prep = await service.preparePoll({
      creatorIdentity: identity, hostWallet, chatId: ctx.chat.id, question, options, mode, durationSeconds,
    });
    if ("error" in prep) return void ctx.reply("⚠️ " + prep.error);

    const msg =
      "🗳️ *Create your poll*\n\n" +
      `*${question}*\n${options.map((o, i) => `${i + 1}. ${o}`).join("\n")}\n\n` +
      "Execute this transaction from your verified wallet to open the poll on-chain (no funds, just gas):\n" +
      `• To: \`${prep.tx.to}\`\n• Data: \`${prep.tx.data}\`\n\n` +
      "The moment it's on-chain I'll post the poll here with a button per option.";
    try {
      await ctx.api.sendMessage(ctx.from!.id, msg, { parse_mode: "Markdown" });
      await ctx.reply("📩 I've DM'd you the one transaction to open the poll.");
    } catch {
      await ctx.reply(msg, { parse_mode: "Markdown" });
    }
  });

  // Vote button
  bot.callbackQuery(/^pv:(\d+):(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    const option = Number(ctx.match![2]);
    const identity = idOf(ctx.from.id);
    if (!service.walletOf(identity)) {
      await ctx.answerCallbackQuery({ text: "Verify first: DM me /verify.", show_alert: true });
      return;
    }
    const res = await service.votePoll(id, identity, option);
    if (res.ok && res.mode === "tap") {
      await ctx.answerCallbackQuery({ text: "✅ Vote counted. Thanks!", show_alert: true });
    } else if (res.ok && res.mode === "onchain") {
      await ctx.answerCallbackQuery({ text: "This poll uses on-chain voting - vote from the FairSeat site.", show_alert: true });
    } else {
      const map: Record<string, string> = {
        not_verified: "Verify first: DM me /verify.",
        not_open: "This poll isn't open.",
        closed: "Voting has closed.",
        already: "You've already voted.",
        bad_option: "Invalid option.",
      };
      await ctx.answerCallbackQuery({ text: map[(res as { reason: string }).reason] ?? "Could not vote.", show_alert: true });
    }
  });

  // Enter button (public / members tap).
  bot.callbackQuery(/^enter:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    const identity = idOf(ctx.from.id);
    if (!service.walletOf(identity)) {
      await ctx.answerCallbackQuery({ text: "Verify first: DM me /verify.", show_alert: true });
      return;
    }
    let membershipOk = true;
    try {
      if (ctx.chat) {
        const m = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id);
        membershipOk = ["member", "administrator", "creator"].includes(m.status);
      }
    } catch {
      membershipOk = false;
    }
    const res = await service.enterGiveaway(id, identity, { membershipOk });
    if (res.ok && res.mode === "tap") {
      await ctx.answerCallbackQuery({ text: "✅ You're in! Good luck.", show_alert: true });
    } else if (res.ok && res.mode === "onchain") {
      await ctx.answerCallbackQuery({ text: "This giveaway uses on-chain entry - DM me /enterchain " + id, show_alert: true });
    } else {
      const map: Record<string, string> = {
        not_verified: "Verify first: DM me /verify.",
        not_open: "This giveaway isn't open.",
        closed: "Entries are closed.",
        already: "You're already entered.",
        wrong_key: "This is a private giveaway - use /enter " + id + " <key> in DM.",
        not_member: "Join the group first to enter.",
      };
      await ctx.answerCallbackQuery({ text: map[(res as { reason: string }).reason] ?? "Could not enter.", show_alert: true });
    }
  });

  // Private-giveaway entry with a key (DM): /enter <id> <key>
  bot.command("enter", async (ctx) => {
    const [idStr, key] = (ctx.match ?? "").trim().split(/\s+/);
    const id = Number(idStr);
    if (!id) return void ctx.reply("Usage: /enter <giveawayId> <access key>");
    const res = await service.enterGiveaway(id, idOf(ctx.from!.id), { membershipOk: true, providedKey: key });
    await ctx.reply(res.ok ? "✅ You're in! Good luck." : "⚠️ Could not enter (" + (res as { reason: string }).reason + ").");
  });

  // ---- notifier (used by the watcher to push updates to Telegram) ----
  const notifier: Notifier = {
    async onVerified(identity, wallet) {
      const tg = tgIdFromIdentity(identity);
      if (tg === null) return; // web users poll the API instead of getting a DM
      await bot.api.sendMessage(
        tg,
        `✅ *Verified!* Your Agent ID wallet \`${wallet}\` is linked. Joining anything is now one tap.`,
        { parse_mode: "Markdown" }
      );
    },
    async onGiveawayLive(g: GiveawayRow) {
      if (!g.chat_id) return; // web-only giveaway: shown on the site, not in Telegram
      const amount = formatAmount(BigInt(g.prize_wei));
      const kb = new InlineKeyboard().text("🎟️ Enter", `enter:${g.id}`);
      const text =
        "🎉 *Giveaway is LIVE!*\n\n" +
        `Prize: *${amount} ${config.nativeSymbol}* · winners: *${g.winner_count}* · ${RULE_LABEL[g.rule]}\n` +
        `Scope: *${g.scope}*${g.scope === "private" ? " (needs access key - /enter " + g.id + " <key> in DM)" : ""}\n\n` +
        "One Agent ID, one seat. Tap to enter 👇\n" +
        `_Locked on-chain: ${config.explorer}/address/${config.vaultAddress}_`;
      const sent = await bot.api.sendMessage(g.chat_id, text, { parse_mode: "Markdown", reply_markup: g.scope === "private" ? undefined : kb });
      // (announce id stored by caller if needed)
      void sent;
    },
    async onResolved(info: ResolvedInfo, seed, txHash) {
      const amount = formatAmount(info.perWinnerWei);
      const lines = info.winners.map((w) => `• \`${w.address}\``).join("\n");
      const text =
        "🏆 *Giveaway resolved!*\n\n" +
        (info.winners.length ? `Winners (${amount} ${config.nativeSymbol} each):\n${lines}\n\n` : "No entrants - prize returned to the host.\n\n") +
        `Provably fair - seed from block hash \`${seed.slice(0, 18)}…\`\n` +
        `Verify on-chain: ${config.explorer}/tx/${txHash}`;
      if (info.giveaway.chat_id) {
        await bot.api.sendMessage(info.giveaway.chat_id, text, { parse_mode: "Markdown" });
      }
      for (const w of info.winners) {
        const tg = w.identity ? tgIdFromIdentity(w.identity) : null;
        if (tg !== null) {
          try {
            await bot.api.sendMessage(tg, `🎉 You won *${amount} ${config.nativeSymbol}*! Paid to \`${w.address}\`.`, {
              parse_mode: "Markdown",
            });
          } catch {
            /* user may not have started the bot */
          }
        }
      }
    },
    async onPollLive(poll: PollRow) {
      if (!poll.chat_id) return;
      const options = JSON.parse(poll.options_json) as string[];
      const kb = new InlineKeyboard();
      options.forEach((o, i) => kb.text(o, `pv:${poll.id}:${i}`).row());
      const text =
        "🗳️ *Poll is live!*\n\n" +
        `*${poll.question}*\n\n` +
        "One Agent ID, one vote. Tap to vote 👇\n" +
        `_Tally is public on-chain: ${config.explorer}/address/${config.pollAddress}_`;
      await bot.api.sendMessage(poll.chat_id, text, { parse_mode: "Markdown", reply_markup: kb });
    },
  };

  // Register the slash-command menu so tapping "/" lists every command with a description.
  bot.api.setMyCommands(COMMAND_MENU).catch((e) => console.error("setMyCommands failed:", e));

  return { bot, notifier };
}

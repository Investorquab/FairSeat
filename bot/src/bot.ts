import { Bot, InlineKeyboard } from "grammy";
import { HttpsProxyAgent } from "https-proxy-agent";
import { ethers } from "ethers";
import type { Chain } from "./chain.js";
import type { Service, ResolvedInfo } from "./service.js";
import type { GiveawayRow } from "./db.js";
import { config } from "./config.js";
import { Rule, EntryMode, RULE_LABEL } from "./service.js";
import { formatAmount } from "./verify.js";
import type { Notifier } from "./watcher.js";

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
    await ctx.reply(
      "👋 *FairSeat* — one Agent ID, one seat.\n\n" +
        "Verify once with your Binance Agent ID, then join giveaways and votes with a tap.\n\n" +
        "• /verify — prove you hold an Agent ID (do this in a private chat with me)\n" +
        "• Admins: add me to your group and run /giveaway to launch a locked, provably-fair giveaway.",
      { parse_mode: "Markdown" }
    );
  });

  // /verify — in a private chat.
  bot.command("verify", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.reply("Please DM me /verify so your verification stays private.");
      return;
    }
    const tid = ctx.from!.id;
    const res = service.startVerification(tid);
    if (res.alreadyVerified) {
      await ctx.reply(`✅ You're already verified.\nWallet: \`${res.wallet}\``, { parse_mode: "Markdown" });
      return;
    }
    const amount = formatAmount(res.amountWei!);
    await ctx.reply(
      "🔐 *Verify your Agent ID*\n\n" +
        "From the Binance AI wallet that holds your Agent ID:\n\n" +
        `1. Add this address to your *Address Book*:\n\`${config.verifierAddress}\`\n\n` +
        `2. Send *exactly* \`${amount}\` ${config.nativeSymbol} to it.\n\n` +
        "That's it — I'll confirm here automatically and refund the tiny amount. No keys, no logins, " +
        "and you confirm the transfer yourself in your own wallet.\n\n" +
        `_Send the exact amount so I can match it to you. Network: ${config.chainId === 56 ? "BNB Chain" : "BNB testnet"}._`,
      { parse_mode: "Markdown" }
    );
  });

  bot.command("mystatus", async (ctx) => {
    const w = service.walletOf(ctx.from!.id);
    await ctx.reply(w ? `✅ Verified. Wallet: \`${w}\`` : "Not verified yet. Send /verify in a private chat.", {
      parse_mode: "Markdown",
    });
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

    const prep = await service.prepareGiveaway({
      creatorTelegramId: ctx.from!.id,
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

  // Enter button (public / members tap).
  bot.callbackQuery(/^enter:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    const tid = ctx.from.id;
    if (!service.walletOf(tid)) {
      await ctx.answerCallbackQuery({ text: "Verify first: DM me /verify.", show_alert: true });
      return;
    }
    let membershipOk = true;
    try {
      if (ctx.chat) {
        const m = await ctx.api.getChatMember(ctx.chat.id, tid);
        membershipOk = ["member", "administrator", "creator"].includes(m.status);
      }
    } catch {
      membershipOk = false;
    }
    const res = await service.enterGiveaway(id, tid, { membershipOk });
    if (res.ok && res.mode === "tap") {
      await ctx.answerCallbackQuery({ text: "✅ You're in! Good luck.", show_alert: true });
    } else if (res.ok && res.mode === "onchain") {
      await ctx.answerCallbackQuery({ text: "This giveaway uses on-chain entry — DM me /enterchain " + id, show_alert: true });
    } else {
      const map: Record<string, string> = {
        not_verified: "Verify first: DM me /verify.",
        not_open: "This giveaway isn't open.",
        closed: "Entries are closed.",
        already: "You're already entered.",
        wrong_key: "This is a private giveaway — use /enter " + id + " <key> in DM.",
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
    const res = await service.enterGiveaway(id, ctx.from!.id, { membershipOk: true, providedKey: key });
    await ctx.reply(res.ok ? "✅ You're in! Good luck." : "⚠️ Could not enter (" + (res as { reason: string }).reason + ").");
  });

  // ---- notifier (used by the watcher to push updates to Telegram) ----
  const notifier: Notifier = {
    async onVerified(telegramId, wallet) {
      await bot.api.sendMessage(
        telegramId,
        `✅ *Verified!* Your Agent ID wallet \`${wallet}\` is linked. Joining anything is now one tap.`,
        { parse_mode: "Markdown" }
      );
    },
    async onGiveawayLive(g: GiveawayRow) {
      const amount = formatAmount(BigInt(g.prize_wei));
      const kb = new InlineKeyboard().text("🎟️ Enter", `enter:${g.id}`);
      const text =
        "🎉 *Giveaway is LIVE!*\n\n" +
        `Prize: *${amount} ${config.nativeSymbol}* · winners: *${g.winner_count}* · ${RULE_LABEL[g.rule]}\n` +
        `Scope: *${g.scope}*${g.scope === "private" ? " (needs access key — /enter " + g.id + " <key> in DM)" : ""}\n\n` +
        "One Agent ID, one seat. Tap to enter 👇\n" +
        `_Locked on-chain: ${config.explorer}/address/${config.vaultAddress}_`;
      const sent = await bot.api.sendMessage(g.chat_id, text, { parse_mode: "Markdown", reply_markup: g.scope === "private" ? undefined : kb });
      // (announce id stored by caller if needed)
      void sent;
    },
    async onResolved(info: ResolvedInfo, seed, txHash) {
      const amount = formatAmount(info.perWinnerWei);
      const lines = info.winners.map((w) => `• \`${w.address}\`${w.telegramId ? ` (<@${w.telegramId}>)` : ""}`).join("\n");
      const text =
        "🏆 *Giveaway resolved!*\n\n" +
        (info.winners.length ? `Winners (${amount} ${config.nativeSymbol} each):\n${lines}\n\n` : "No entrants — prize returned to the host.\n\n") +
        `Provably fair — seed from block hash \`${seed.slice(0, 18)}…\`\n` +
        `Verify on-chain: ${config.explorer}/tx/${txHash}`;
      await bot.api.sendMessage(info.giveaway.chat_id, text, { parse_mode: "Markdown" });
      for (const w of info.winners) {
        if (w.telegramId) {
          try {
            await bot.api.sendMessage(w.telegramId, `🎉 You won *${amount} ${config.nativeSymbol}*! Paid to \`${w.address}\`.`, {
              parse_mode: "Markdown",
            });
          } catch {
            /* user may not have started the bot */
          }
        }
      }
    },
  };

  return { bot, notifier };
}

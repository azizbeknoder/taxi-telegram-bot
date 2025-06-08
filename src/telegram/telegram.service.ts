import { Injectable, Logger } from '@nestjs/common';
import { Telegraf, Markup, Context, session } from 'telegraf';

interface MySession {
  step?: string;
  role?: 'passenger' | 'driver';
  route?: string;
  phone?: string;
  seats?: number;
  hasWoman?: boolean;
  hasAC?: boolean;
  time?: string;
  acceptsPost?: boolean;
}

type MyContext = Context & { session: MySession };

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Telegraf<MyContext>;

  private readonly PASSENGER_GROUP_ID = -1002083291047; // Yo'lovchilar guruhi chat ID-si
  private readonly DRIVER_GROUP_ID = -1002574496144;    // Haydovchilar guruhi chat ID-si

  constructor() {
    // BOT TOKEN'ni .env dan olish, agar topilmasa xatolik berish
    const token = process.env.BOT_TOKEN;
    if (!token) {
      this.logger.error('BOT_TOKEN environment variable is not set!');
      throw new Error('BOT_TOKEN environment variable is required');
    }

    this.bot = new Telegraf<MyContext>(token);

    // Session middleware o'rnatish
    this.bot.use(session({ defaultSession: (): MySession => ({}) }));

    // /start komandasi ishlovchi
    this.bot.start(async (ctx) => {
      this.resetSession(ctx);
      await ctx.reply(
        "Salom! Siz foydalanuvchimisiz yoki taxi haydovchi?",
        Markup.keyboard([["Yo'lovchi", "Taxi Haydovchi"]])
          .resize()
          .oneTime()
      );
    });

    // Yo'lovchi tanlaganda
    this.bot.hears("Yo'lovchi", async (ctx) => {
      ctx.session.step = "awaitingUserRoute";
      ctx.session.role = "passenger";
      await ctx.reply(
        "Qayerdan qayergacha yoʻnalishni tanlang:",
        Markup.keyboard([
          ["Beshariq ➡️ Fargʻona"],
          ["Fargʻona ➡️ Beshariq"],
        ])
          .resize()
          .oneTime()
      );
    });

    // Haydovchi tanlaganda
    this.bot.hears("Taxi Haydovchi", async (ctx) => {
      ctx.session.step = "awaitingDriverRoute";
      ctx.session.role = "driver";
      await ctx.reply(
        "Qayerdan qayergacha yoʻnalishni tanlang:",
        Markup.keyboard([
          ["Beshariq ➡️ Fargʻona"],
          ["Fargʻona ➡️ Beshariq"],
        ])
          .resize()
          .oneTime()
      );
    });

    // Matn xabarlar uchun umumiy handler
    this.bot.on("text", async (ctx) => {
      const text = ctx.message?.text?.trim();
      if (!text) return;

      const step = ctx.session.step;

      try {
        switch (step) {
          case "awaitingUserRoute":
            if (this.isValidRoute(text)) {
              ctx.session.route = text;
              ctx.session.step = "awaitingUserPhone";
              await ctx.reply(
                "Iltimos, telefon raqamingizni yuboring:",
                Markup.removeKeyboard()
              );
            } else {
              await ctx.reply("Iltimos, menyudan yo‘nalishni tanlang!");
            }
            break;

          case "awaitingUserPhone":
            if (!this.isValidPhone(text)) {
              await ctx.reply(
                "Iltimos, telefon raqamini to‘g‘ri formatda yuboring (masalan: +998901234567)"
              );
              break;
            }
            ctx.session.phone = text;
            await this.sendToGroup(
              ctx,
              this.buildPassengerMessage(ctx),
              "passenger"
            );
            break;

          case "awaitingDriverRoute":
            if (this.isValidRoute(text)) {
              ctx.session.route = text;
              ctx.session.step = "awaitingDriverPhone";
              await ctx.reply(
                "Iltimos, telefon raqamingizni yuboring:",
                Markup.removeKeyboard()
              );
            } else {
              await ctx.reply("Iltimos, menyudan yo‘nalishni tanlang!");
            }
            break;

          case "awaitingDriverPhone":
            if (!this.isValidPhone(text)) {
              await ctx.reply(
                "Iltimos, telefon raqamini to‘g‘ri formatda yuboring (masalan: +998901234567)"
              );
              break;
            }
            ctx.session.phone = text;
            ctx.session.step = "awaitingDriverSeats";
            await ctx.reply(
              "Mashinangizda nechta bo‘sh joy bor?",
              Markup.keyboard([["1", "2", "3", "4"]]).resize().oneTime()
            );
            break;

          case "awaitingDriverSeats":
            const seats = parseInt(text, 10);
            if (![1, 2, 3, 4].includes(seats)) {
              await ctx.reply("Iltimos, 1 dan 4 gacha raqamni tanlang.");
              break;
            }
            ctx.session.seats = seats;
            ctx.session.step = "awaitingDriverWoman";
            await ctx.reply(
              "Mashinada ayol yo‘lovchi bormi?",
              Markup.keyboard([["Ha", "Yo‘q"]]).resize().oneTime()
            );
            break;

          case "awaitingDriverWoman":
            if (!["Ha", "Yo‘q"].includes(text)) {
              await ctx.reply('Iltimos, "Ha" yoki "Yo‘q" ni tanlang.');
              break;
            }
            ctx.session.hasWoman = text === "Ha";
            ctx.session.step = "awaitingDriverAC";
            await ctx.reply(
              "Mashinada konditsioner bormi?",
              Markup.keyboard([["Ha", "Yo‘q"]]).resize().oneTime()
            );
            break;

          case "awaitingDriverAC":
            if (!["Ha", "Yo‘q"].includes(text)) {
              await ctx.reply('Iltimos, "Ha" yoki "Yo‘q" ni tanlang.');
              break;
            }
            ctx.session.hasAC = text === "Ha";
            ctx.session.step = "awaitingDriverTime";
            await ctx.reply("Jo‘nash vaqtini kiriting (masalan: 14:00):", Markup.removeKeyboard());
            break;

          case "awaitingDriverTime":
            if (!this.isValidTime(text)) {
              await ctx.reply(
                "Iltimos, vaqtni HH:MM formatda kiriting (masalan: 08:30 yoki 17:45)"
              );
              break;
            }
            ctx.session.time = text;
            ctx.session.step = "awaitingDriverPost";
            await ctx.reply(
              "Poshta qabul qilasizmi?",
              Markup.keyboard([["Ha", "Yo‘q"]]).resize().oneTime()
            );
            break;

          case "awaitingDriverPost":
            if (!["Ha", "Yo‘q"].includes(text)) {
              await ctx.reply('Iltimos, "Ha" yoki "Yo‘q" ni tanlang.');
              break;
            }
            ctx.session.acceptsPost = text === "Ha";
            await this.sendToGroup(ctx, this.buildDriverMessage(ctx), "driver");
            break;

          default:
            await ctx.reply(
              "Iltimos, /start buyrug‘ini yuboring va menyudan foydalaning."
            );
            break;
        }
      } catch (error) {
        this.logger.error("Xatolik:", error);
        await ctx.reply("Kutilmagan xatolik yuz berdi.");
        this.resetSession(ctx);
      }
    });

    this.bot.launch();
    this.logger.log("Telegram bot ishga tushdi");
  }

  private resetSession(ctx: MyContext) {
    ctx.session = {};
  }

  private isValidRoute(text: string): boolean {
    const validRoutes = ["Beshariq ➡️ Fargʻona", "Fargʻona ➡️ Beshariq"];
    return validRoutes.includes(text);
  }

  private isValidPhone(text: string): boolean {
    // Telefon raqami +998901234567 yoki 998901234567 ko'rinishida bo'lishi mumkin
    return /^\+?998\d{9}$/.test(text);
  }

  private isValidTime(text: string): boolean {
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(text);
  }

  private buildPassengerMessage(ctx: MyContext): string {
    return `🚕 Yangi yo‘lovchi:\n🛣 Yo‘nalish: ${ctx.session.route}\n📞 Tel: ${ctx.session.phone}\n👤 ${ctx.from?.first_name || "Ismsiz"}`;
  }

  private buildDriverMessage(ctx: MyContext): string {
    return `🚖 Taxi haydovchi:\n🛣 Yo‘nalish: ${ctx.session.route}\n📞 Tel: ${ctx.session.phone}\n👥 Joylar: ${ctx.session.seats}\n👩 Ayol yo‘lovchi: ${
      ctx.session.hasWoman ? "Bor" : "Yo‘q"
    }\n❄️ Konditsioner: ${ctx.session.hasAC ? "Bor" : "Yo‘q"}\n⏰ Vaqt: ${
      ctx.session.time
    }\n📮 Poshta: ${ctx.session.acceptsPost ? "Ha" : "Yo‘q"}`;
  }

  private async sendToGroup(
    ctx: MyContext,
    message: string,
    role: "driver" | "passenger"
  ) {
    try {
      // Bu yerda chatId teskari bo‘lib qo‘yilgan edi, tuzatildi:
      // Agar rol driver bo'lsa, xabar haydovchilar guruhiga, aks holda yo'lovchilar guruhiga yuboriladi.
      const chatId = role === "driver" ? this.DRIVER_GROUP_ID : this.PASSENGER_GROUP_ID;

      await ctx.telegram.sendMessage(chatId, message);
      await ctx.reply("Ma'lumot qabul qilindi. Rahmat!");
      this.resetSession(ctx);
    } catch (error: any) {
      if (error.description?.includes("retry after")) {
        const retryAfter = parseInt(error.description.match(/retry after (\d+)/)?.[1] || "3", 10);
        await new Promise((r) => setTimeout(r, (retryAfter + 1) * 1000));
        return this.sendToGroup(ctx, message, role);
      } else {
        this.logger.error("Xatolik guruhga yuborishda:", error);
        await ctx.reply("Xatolik yuz berdi, iltimos keyinroq urinib ko‘ring.");
      }
    }
  }
}

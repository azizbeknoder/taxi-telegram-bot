import { Injectable, Logger } from '@nestjs/common';
import { Telegraf, Markup, session, Context } from 'telegraf';

interface MySession {
  step?: string;
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

  constructor() {
    this.bot = new Telegraf<MyContext>(process.env.BOT_TOKEN || '');
    this.bot.use(session());
    this.bot.use(async (ctx, next) => {
      if (!ctx.session) ctx.session = {};
      await next();
    });

    // START
    this.bot.start(async (ctx) => {
      ctx.session = {};
      await ctx.reply(
        'Salom! Siz foydalanuvchimisiz yoki taxi haydovchi?',
        Markup.keyboard([['Foydalanuvchi', 'Taxi Haydovchi']])
          .resize()
          .oneTime()
      );
    });

    // FOYDALANUVCHI
    this.bot.hears('Foydalanuvchi', async (ctx) => {
      ctx.session.step = 'awaitingUserRoute';
      await ctx.reply(
        'Qayerdan qayergacha yoʻnalishni tanlang:',
        Markup.keyboard([
          ['Beshariq ➡️ Fargʻona'],
          ['Fargʻona ➡️ Beshariq'],
        ])
          .resize()
          .oneTime()
      );
    });

    // TAXI HAYDOVCHI
    this.bot.hears('Taxi Haydovchi', async (ctx) => {
      ctx.session.step = 'awaitingDriverRoute';
      await ctx.reply(
        'Qayerdan qayergacha yoʻnalishni tanlang:',
        Markup.keyboard([
          ['Beshariq ➡️ Fargʻona'],
          ['Fargʻona ➡️ Beshariq'],
        ])
          .resize()
          .oneTime()
      );
    });

    // TEXT HANDLER
    this.bot.on('text', async (ctx) => {
      const step = ctx.session?.step;
      const text = ctx.message.text;

      // === FOYDALANUVCHI ===
      if (step === 'awaitingUserRoute') {
        if (text === 'Beshariq ➡️ Fargʻona' || text === 'Fargʻona ➡️ Beshariq') {
          ctx.session.route = text;
          ctx.session.step = 'awaitingUserPhone';
          await ctx.reply('Iltimos, telefon raqamingizni yuboring:', Markup.removeKeyboard());
        } else {
          await ctx.reply('Iltimos, menyudan yo‘nalishni tanlang!');
        }
      } else if (step === 'awaitingUserPhone') {
        const phoneRegex = /^\+?\d{9,15}$/;
        if (!phoneRegex.test(text)) {
          return await ctx.reply('Iltimos, telefon raqamini to‘g‘ri formatda yuboring (masalan: +998901234567)');
        }

        const msg = `🚕 Yangi yo‘lovchi:\n🛣 Yo‘nalish: ${ctx.session.route}\n📞 Tel: ${text}\n👤 ${ctx.from?.first_name || 'Ismsiz'}`;
        try {
          await this.safeSendMessage(process.env.GROUP_ID || '', msg);
          await ctx.reply('Rahmat! Ma’lumotlaringiz jo‘natildi.', Markup.removeKeyboard());
        } catch (error) {
          await ctx.reply('Xatolik yuz berdi.');
        }

        ctx.session = {};
      }

      // === TAXI HAYDOVCHI ===
      else if (step === 'awaitingDriverRoute') {
        if (text === 'Beshariq ➡️ Fargʻona' || text === 'Fargʻona ➡️ Beshariq') {
          ctx.session.route = text;
          ctx.session.step = 'awaitingDriverPhone';
          await ctx.reply('Iltimos, telefon raqamingizni yuboring:', Markup.removeKeyboard());
        } else {
          await ctx.reply('Iltimos, menyudan yo‘nalishni tanlang!');
        }
      } else if (step === 'awaitingDriverPhone') {
        const phoneRegex = /^\+?\d{9,15}$/;
        if (!phoneRegex.test(text)) {
          return await ctx.reply('Iltimos, telefon raqamini to‘g‘ri formatda yuboring (masalan: +998901234567)');
        }

        ctx.session.phone = text;
        ctx.session.step = 'awaitingDriverSeats';
        await ctx.reply(
          'Mashinangizda nechta bo‘sh joy bor?',
          Markup.keyboard([['1', '2', '3', '4']]).resize().oneTime()
        );
      } else if (step === 'awaitingDriverSeats') {
        const seats = parseInt(text);
        if (![1, 2, 3, 4].includes(seats)) {
          return await ctx.reply('Iltimos, 1 dan 4 gacha raqamni tanlang.');
        }

        ctx.session.seats = seats;
        ctx.session.step = 'awaitingDriverWoman';
        await ctx.reply(
          'Mashinada ayol yo‘lovchi bormi?',
          Markup.keyboard([['Ha', 'Yo‘q']]).resize().oneTime()
        );
      } else if (step === 'awaitingDriverWoman') {
        if (!['Ha', 'Yo‘q'].includes(text)) {
          return await ctx.reply('Iltimos, "Ha" yoki "Yo‘q" ni tanlang.');
        }

        ctx.session.hasWoman = text === 'Ha';
        ctx.session.step = 'awaitingDriverAC';
        await ctx.reply(
          'Mashinada konditsioner bormi?',
          Markup.keyboard([['Ha', 'Yo‘q']]).resize().oneTime()
        );
      } else if (step === 'awaitingDriverAC') {
        if (!['Ha', 'Yo‘q'].includes(text)) {
          return await ctx.reply('Iltimos, "Ha" yoki "Yo‘q" ni tanlang.');
        }

        ctx.session.hasAC = text === 'Ha';
        ctx.session.step = 'awaitingDriverTime';
        await ctx.reply('Iltimos, jo‘nash vaqtini kiriting (masalan: 14:00):', Markup.removeKeyboard());
      } else if (step === 'awaitingDriverTime') {
        const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
        if (!timeRegex.test(text)) {
          return await ctx.reply('Iltimos, vaqtni HH:MM formatda kiriting (masalan: 08:30 yoki 17:45)');
        }

        ctx.session.time = text;
        ctx.session.step = 'awaitingDriverPost';
        await ctx.reply(
          'Poshta qabul qilasizmi?',
          Markup.keyboard([['Ha', 'Yo‘q']]).resize().oneTime()
        );
      } else if (step === 'awaitingDriverPost') {
        if (!['Ha', 'Yo‘q'].includes(text)) {
          return await ctx.reply('Iltimos, "Ha" yoki "Yo‘q" ni tanlang.');
        }

        ctx.session.acceptsPost = text === 'Ha';

        const msg = `🚖 Taxi haydovchi:\n🛣 Yo‘nalish: ${ctx.session.route}\n📞 Tel: ${ctx.session.phone}\n👥 Joylar: ${ctx.session.seats}\n👩 Ayol yo‘lovchi: ${ctx.session.hasWoman ? 'Bor' : 'Yo‘q'}\n❄️ Konditsioner: ${ctx.session.hasAC ? 'Bor' : 'Yo‘q'}\n⏰ Jo‘nash vaqti: ${ctx.session.time}\n📦 Poshta: ${ctx.session.acceptsPost ? 'Qabul qilinadi' : 'Qabul qilinmaydi'}\n👤 ${ctx.from?.first_name || 'Ismsiz'}`;

        try {
          await this.safeSendMessage(process.env.GROUP_ID || '', msg);
          await ctx.reply('Rahmat! Ma’lumotlaringiz jo‘natildi.', Markup.removeKeyboard());
        } catch (error) {
          await ctx.reply('Xatolik yuz berdi.');
        }

        ctx.session = {};
      } else {
        await ctx.reply('Iltimos, /start buyrug‘ini yuboring va menyudan foydalaning.');
      }
    });

    this.bot.launch();
  }

  private async safeSendMessage(chatId: string | number, message: string): Promise<void> {
    try {
      await this.bot.telegram.sendMessage(chatId, message);
    } catch (error: any) {
      if (error?.response?.error_code === 429 && error.response.parameters?.retry_after) {
        const waitTime = error.response.parameters.retry_after;
        this.logger.warn(`Too many requests. Waiting for ${waitTime} seconds...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime * 1000));
        return this.safeSendMessage(chatId, message);
      } else {
        this.logger.error('Xabar yuborishda xatolik:', error);
        throw error;
      }
    }
  }
}

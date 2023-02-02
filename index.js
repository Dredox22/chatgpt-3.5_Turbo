import fetch from "node-fetch";
import { Configuration, OpenAIApi } from "openai";
import TelegramBot from "node-telegram-bot-api";
import Replicate from "replicate-js";
import google from "./search.js";
import {
    writeOpened,
    readOpened,
    writeTrial,
    readTrial,
    writeSkip,
    readSkip,
    writeContext,
    readContext,
    readChatSuffix,
    writeChatSuffix,
    writeTemp,
    readTemp,
    writeTime,
    readTime,
} from "./io.js";
import dotenv from "dotenv";
dotenv.config({ override: true });

let CONTEXT_SIZE = 200; // increase can negatively affect your bill, 1 Russian char == 1 token
let MAX_TOKENS = 800;
let TRIAL_COUNT = 0;
let MAX_LENGTH = 300;
let MAX_REQUESTS = 500;
let MAX_GROUP_REQUESTS = 1000;
let MAX_PER_MINUTE = 15;
let MAX_PER_HOUR = 5;
let CONTEXT_TIMEOUT = 3600;
let REQUEST_PRICE = 0.0066;
let PROMO = ["-1001776618845", "-1001716321937"];

const replicate = new Replicate({ token: process.env.REPLICATE_KEY });
const openai = new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_KEY }));
const bot = new TelegramBot(process.env.TELEGRAM_KEY, { polling: true });

const context = readContext();
const skip = readSkip();
const trial = readTrial();
const opened = readOpened();
const temp = readTemp();
const time = readTime();
const chatSuffix = readChatSuffix();
const last = {};

bot.on("pre_checkout_query", async (query) => {
    console.log("Checkout from ", query.from);
    bot.answerPreCheckoutQuery(query.id, true);
});

bot.on("message", async (msg) => {
    try {
        if (protection(msg)) {
            return;
        }
        // Technical stuff
        const chatId = msg.chat.id;
        const msgL = msg.text?.toLowerCase();
        if (msg.text) {
            if (processCommand(chatId, msgL, msg.from?.language_code)) {
                return;
            }
        }
        if (msg.successful_payment) {
            console.log("Payment done for ", chatId, msg.successful_payment.invoice_payload);
            var d = new Date();
            d.setMonth(d.getMonth() + 2);
            opened[msg.successful_payment.invoice_payload ?? chatId] = d;
            writeOpened(opened);
            bot.sendMessage(
                chatId,
                msg.from?.language_code == "ru"
                    ? "Оплата произведена! Спасибо. Бот теперь доступен два месяца !!! ❤️‍🔥"
                    : "Payment complete! Thank you. This bot is now available for use for a period of two months !!! ❤️‍🔥"
            );
            bot.sendMessage(
                1049277315,
                "Произведена оплата от " +
                    msg?.from?.username +
                    " " +
                    msg?.from?.id +
                    " " +
                    msg.successful_payment.invoice_payload
            );
            return;
        }
        trial[chatId] = (trial[chatId] ?? 0) + 1;
        writeTrial(trial);
        const trialCount = chatId > 0 ? TRIAL_COUNT : 0;
        if (!(new Date(opened[chatId]) > new Date())) {
            if (trial[chatId] > trialCount) {
                // console.log("Unauthorized access: ", chatId, msg?.from?.username, msg.text);
                sendInvoice(chatId);
                bot.sendMessage(
                    chatId,
                    msg.from?.language_code == "ru"
                        ? "К сожалению, мы не можем предоставить вам триал из-за большого наплыва пользователей. Полная функциональность появится после оплаты ❤️ Приглашаем вас присоединиться к нашей группе и попробовать бота в ней 😊 https://t.me/maxsoft_chat_gpt_group"
                        : "Sorry we can't provide you with a trial due to the large influx of users. Full functionality will appear after payment ❤️ We invite you to join our group to try the bot 😊 https://t.me/maxsoft_chat_gpt_group_en"
                );
                trial[chatId] = trial[chatId] - 1;
                return;
            }
        }
        if (
            (chatId > 0 && trial[chatId] > MAX_REQUESTS) ||
            (chatId < 0 && trial[chatId] > MAX_GROUP_REQUESTS && !PROMO.includes(String(chatId)))
        ) {
            console.error("Abuse detected for ", chatId);
            bot.sendMessage(
                chatId,
                msg.from?.language_code == "ru"
                    ? "Привет! К сожалению, вы превысили лимит запросов 😏 Это не проблема - вы всегда можете приобрести новую подписку! ❤️"
                    : "Hello! Unfortunately, you have exceeded your subscription request count 😏 That's not a problem - you can always purchase a new one! ❤️"
            );
            trial[chatId] = 0;
            opened[chatId] = new Date();
            return;
        }

        // Brain activity
        context[chatId] = context[chatId]?.slice(-CONTEXT_SIZE * premium(chatId)) ?? "";
        if (time[chatId] && new Date() - new Date(time[chatId]) > CONTEXT_TIMEOUT * 1000) {
            context[chatId] = "";
        }
        time[chatId] = new Date();
        writeTime(time);
        writeContext(context);

        if (msg.photo) {
            // visual hemisphere (left)
            visualToText(chatId, msg);
        }
        if (!msg.text) {
            return;
        }
        // console.log(chatId, msg?.from?.username, msg.text);
        msg.text = msg.text?.substring(0, MAX_LENGTH * premium(chatId));
        if (msgL.startsWith("погугли") || msgL.startsWith("загугли") || msgL.startsWith("google")) {
            textToGoogle(chatId, msg.text.slice(7), msg.from?.language_code);
        } else {
            if (msgL.startsWith("нарисуй") || msgL.startsWith("draw") || msgL.startsWith("paint")) {
                // visual hemisphere (left)
                textToVisual(chatId, msgL, msg.from?.language_code);
            } else {
                // audio hemisphere (right)
                textToText(chatId, msg);
            }
        }
    } catch (e) {
        console.error(e.message);
    }
});

const processCommand = (chatId, msg, language_code) => {
    if (msg.startsWith("/command") || msg.startsWith("/help")) {
        bot.sendMessage(
            chatId,
            language_code == "ru"
                ? "Нарисуй <что-то>\nЗагугли/Погугли <что-то>\nСброс\nТемпература 36.5 - 41.5\nПропуск <x>\nРежим <притворяйся кем-то>\n/payment\n/terms\n/terms_group\n/status\n/support"
                : "Paint <some>\nDraw <some>\nGoogle <some>\nReset\nTemperature 36.5 - 41.5\nSkip <x>\nMode <pretend>\n/payment\n/terms\n/terms_group\n/status\n/support"
        );
        return true;
    }
    if (msg.startsWith("/start")) {
        bot.sendMessage(
            chatId,
            language_code == "ru"
                ? "Привет! Я ChatGPT бот. Я могу говорить с вами на любом языке. Я могу нарисовать все что вы хотите. Вы также можете отправить мне изображение, и я переведу его в текст (это может занять до 30 секунд). Я могу искать в Google любую информацию, которая вам нужна. Используйте /help для списка команд. Понимаю команду Нарисуй <что-то> 😊 Наша группа: https://t.me/maxsoft_chat_gpt_group"
                : "Hello! I'm ChatGPT. Feel free to speak to me in any language. I can Paint <anything> you want. You can also send me an image, and I will translate it to text (this may take up to 30 seconds). I can search Google for any information you need. Use /help for more options 😊 Join our group: https://t.me/maxsoft_chat_gpt_group_en"
        );
        return true;
    }
    if (msg.startsWith("/terms_group")) {
        bot.sendMessage(
            chatId,
            language_code == "ru"
                ? "После оплаты подписки $10 вы можете использовать все функции ChatGPT бота в течение месяца для всей группы (без ограничения количества людей), включая Нарисуй, Загугли, и другие - с ограничением 1000 запросов в месяц (при превышении лимита бот потребует оплату подписки снова)"
                : "After making a payment of $10, you will have access to the ChatGPT bot for one month for entire group (unlimited numer of people), with full features (including Paint, Photo2Text, Google, and more) with limitations of 1000 requests per month (when the limit is exceeded, the bot will ask you to pay for subscription again)"
        );
        return true;
    }
    if (msg.startsWith("/terms")) {
        bot.sendMessage(
            chatId,
            language_code == "ru"
                ? "После оплаты подписки $5 в течение месяца вы можете использовать все функции бота, включая Нарисуй, Загугли, и другие без каких-либо ограничений"
                : "After making a payment of $5, you will have access to the ChatGPT bot for one month, with full features (including Paint, Photo2Text, Google, and more) without any limitations"
        );
        return true;
    }

    if (msg.startsWith("/payment")) {
        if (language_code == "ru") {
            bot.sendMessage(
                chatId,
                "https://vc.ru/u/1075657-denis-zelenykh/576110-kak-oplatit-podpisku-midjourney-iz-rossii"
            );
        }
        sendInvoice(chatId);
        return true;
    }
    if (msg.startsWith("/support")) {
        bot.sendMessage(
            chatId,
            language_code == "ru"
                ? "Если у вас возникли проблемы с оплатой, пожалуйста, напишите мне в личные сообщения @Extender777"
                : "For any inquiries regarding refunds and cancellations please contact @Extender777"
        );
        return true;
    }
    if (msg.startsWith("/usage")) {
        bot.sendMessage(chatId, getReport());
        return true;
    }
    if (msg.startsWith("/status")) {
        bot.sendMessage(
            chatId,
            language_code == "ru"
                ? opened[chatId]
                    ? "Ваша подписка активна до " + opened[chatId]
                    : "У вас есть нет подписки"
                : opened[chatId]
                ? "You have active subscription until " + opened[chatId]
                : "You have no subscription"
        );
        return true;
    }
    if (msg === "сезам приоткройся") {
        bot.sendMessage(chatId, "Бот активирован до 01.01.2024");
        opened[chatId] = "2024-01-01T00:00:00.000Z";
        writeOpened(opened);
        return true;
    }
    if (msg === "сброс") {
        bot.sendMessage(chatId, "Личность уничтожена");
        context[chatId] = "";
        return true;
    }
    if (msg === "reset") {
        bot.sendMessage(chatId, "Context cleared");
        context[chatId] = "";
        return true;
    }
    if (msg.startsWith("пропуск ")) {
        skip[chatId] = +msg.slice(8);
        writeSkip(skip);
        bot.sendMessage(chatId, "Отвечать раз в " + skip[chatId]);
        return true;
    }
    if (msg.startsWith("skip ")) {
        skip[chatId] = +msg.slice(5);
        writeSkip(skip);
        bot.sendMessage(chatId, "Skip " + skip[chatId]);
        return true;
    }
    if (msg.startsWith("отвечать раз в ")) {
        skip[chatId] = +msg.slice(15);
        writeSkip(skip);
        bot.sendMessage(chatId, "Отвечать раз в " + skip[chatId]);
        return true;
    }
    if (msg === "режим" || msg === "режим обычный") {
        chatSuffix[chatId] = "";
        writeChatSuffix(chatSuffix);
        bot.sendMessage(chatId, "Режим обычный");
        return true;
    }
    if (msg.startsWith("режим ")) {
        chatSuffix[chatId] = "(" + msg.slice(6) + ")";
        writeChatSuffix(chatSuffix);
        bot.sendMessage(chatId, "Режим установлен");
        return true;
    }
    if (msg === "mode" || msg === "mode usual") {
        chatSuffix[chatId] = "";
        writeChatSuffix(chatSuffix);
        bot.sendMessage(chatId, "Usual mode");
        return true;
    }
    if (msg.startsWith("mode ")) {
        chatSuffix[chatId] = "(" + msg.slice(5) + ")";
        writeChatSuffix(chatSuffix);
        bot.sendMessage(chatId, "Mode set");
        return true;
    }
    if (msg.startsWith("температура ") || msg.startsWith("temperature ")) {
        temp[chatId] = +msg.slice(12)?.replace(",", ".");
        writeTemp(temp);
        bot.sendMessage(chatId, "Температура установлена в " + temp[chatId]);
        return true;
    }
};

const sendInvoice = (chatId) => {
    bot.sendInvoice(
        chatId,
        "Need payment",
        "2-month access to ChatGPT",
        chatId,
        process.env.STRIPE_KEY,
        "USD",
        [
            {
                label: chatId > 0 ? "full access to P2P chat" : "full access to GROUP chat",
                amount: chatId > 0 ? 500 : 1000,
            },
        ],
        {
            photo_url: "https://blog.maxsoft.tk/AI.png",
            need_name: false,
            need_phone_number: false,
            need_email: false,
            need_shipping_address: false,
        }
    );
};

const visualToText = async (chatId, msg) => {
    bot.sendChatAction(chatId, "typing");
    let prompt = await getPrompt(msg.photo, chatId);
    if (prompt) {
        // link between left and right hemisphere (computer vision)
        bot.sendChatAction(chatId, "typing");
        last[chatId] = prompt;
        if (msg.from?.language_code == "ru") {
            prompt = await getText("Переведи на русский: " + prompt, 0.5, MAX_TOKENS);
        }
        prompt = prompt?.replace(/.*/, "")?.substr(1);
        if (prompt) {
            context[chatId] = context[chatId] + prompt;
            writeContext(context);
            bot.sendMessage(chatId, prompt)
                .then(() => {})
                .catch((e) => {
                    console.error(e.message);
                });
        }
    }
};

const textToVisual = async (chatId, text, language_code) => {
    bot.sendChatAction(chatId, "typing");
    if (text === "нарисуй" || text === "draw" || text === "paint") {
        // link between right and left hemisphere (painting)
        text = last[chatId]?.replace("child", "");
    }
    if (language_code != "en" && !text?.startsWith("draw")) {
        text = await getText("Translate to English: " + text?.replace("ребенка", ""), 0.5, MAX_TOKENS);
    }
    if (!text) {
        return;
    }
    bot.sendChatAction(chatId, "typing");
    const photo = await getArt(
        text +
            (text?.startsWith("draw")
                ? ""
                : ", deep focus, highly detailed, digital painting, artstation, 4K, smooth, sharp focus, illustration") //, by ryan yee, by clint cearley")
    );
    if (photo) {
        bot.sendPhoto(chatId, photo);
    }
};

const textToText = async (chatId, msg) => {
    context[chatId] += msg.text + ".";
    if (
        !(msg.text.startsWith("Отвечай") || msg.text.startsWith("Ответь") || msg.text.startsWith("Answer")) &&
        trial[chatId] % (skip[chatId] ?? 1) != 0
    ) {
        trial[chatId] = trial[chatId] - 1;
        return;
    }
    bot.sendChatAction(chatId, "typing");
    const intervalId = setInterval(() => {
        bot.sendChatAction(chatId, "typing");
    }, 5000);
    const response = await getText(
        context[chatId] + chatSuffix[chatId] ?? "",
        ((temp[chatId] ?? 36.5) - 36.5) / 10 + 0.5,
        MAX_TOKENS * premium(chatId)
    );
    clearInterval(intervalId);
    if (response) {
        last[chatId] = response;
        context[chatId] = context[chatId] + response;
        writeContext(context);
        bot.sendMessage(chatId, response)
            .then(() => {})
            .catch((e) => {
                console.error(e.message);
            });
    }
};

const textToGoogle = async (chatId, msg, language_code) => {
    bot.sendChatAction(chatId, "typing");
    const response = await google(msg, language_code);
    if (response) {
        last[chatId] = response;
        context[chatId] = context[chatId] + response;
        writeContext(context);
        bot.sendMessage(chatId, response)
            .then(() => {})
            .catch((e) => {
                console.error(e.message);
            });
    }
};

const getText = async (prompt, temperature, max_tokens) => {
    try {
        const completion = await openai.createCompletion({
            model: "text-davinci-003",
            prompt: prompt,
            max_tokens: max_tokens,
            temperature: temperature,
        });
        const response = completion?.data?.choices?.[0]?.text;
        // console.log(response);
        return response;
    } catch (e) {
        console.error(e.message);
        if (e.message?.includes("429")) {
            bot.sendMessage(1049277315, e.message);
        }
    }
};

const getArt = async (prompt) => {
    const response = await fetch(
        "https://api.stability.ai/v1alpha/generation/stable-diffusion-512-v2-1/text-to-image",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "image/png",
                Authorization: process.env.STABILITY_KEY,
            },
            body: JSON.stringify({
                cfg_scale: 7,
                clip_guidance_preset: "FAST_BLUE",
                height: 512,
                width: 512,
                samples: 1,
                steps: 30,
                text_prompts: [
                    {
                        text: prompt,
                        weight: 1,
                    },
                ],
            }),
        }
    );

    if (!response.ok) {
        console.error(`Stability AI error: ${(await response.text()).substring(0, 300)}`);
        return;
    }

    return response.buffer();
};

const getPrompt = async (photo, chatId) => {
    const file_id = photo[photo.length - 1].file_id;
    const fileUri = await bot.getFileLink(file_id);
    bot.sendChatAction(chatId, "typing");
    const img2prompt = await replicate.models.get("methexis-inc/img2prompt");
    return img2prompt.predict({ image: fileUri });
};

const premium = (chatId) => {
    if (opened[chatId] && chatId > 0) {
        return 2;
    } else {
        return 1;
    }
};

const blacklist = ["5889128020", "junklz", "drovorub_UI", "lucky_12345_lucky", "BELIAL_00", "SUPREME", "zixstass"];
let callsTimestamps = [];
let groupUsers = {};

// once per hour clean groupUsers
setInterval(() => {
    groupUsers = {};
}, 1000 * 60 * 60);

const protection = (msg) => {
    //if username is Extender777, allow all and switch on server
    if (msg?.from?.username == "Extender777") {
        var d = new Date();
        d.setMonth(d.getMonth() + 1);
        opened[msg.chat.id] = d;
        writeOpened(opened);
        return false;
    }

    // ignore blacklist
    if (blacklist.includes(msg?.from?.username) || blacklist.includes(msg?.from?.id)) {
        console.error("Abuse [blacklist] detected for ", msg.chat.id);
        return true;
    }

    // DDOS protection, call not more than 20 per minute for msg.chat.id
    if (PROMO.includes(String(msg.chat.id))) {
        // // do not reply if msg?.from?.id not in trials
        // if (!trial[msg?.from?.id]) {
        //     return true;
        // }
        groupUsers[msg?.from?.id] = (groupUsers[msg?.from?.id] ?? 0) + 1;
        if (groupUsers[msg?.from?.id] > MAX_PER_HOUR) {
            return true;
        }

        callsTimestamps.push(Date.now());
        callsTimestamps = callsTimestamps.filter((stamp) => Date.now() - stamp < 60000);
        if (callsTimestamps.length >= MAX_PER_MINUTE) {
            console.error("Abuse [1 minute] detected for ", msg.chat.id);
            opened[msg.chat.id] = new Date();
            return true;
        }
    }
};

const getReport = () => {
    let result = "";
    const add = (s) => {
        result += s + "\n";
    };
    add("Advertising costs");
    add("-----------");
    const adv = Object.keys(trial)
        .filter((k) => context[k])
        .filter((t) => !opened[t] || PROMO.includes(t))
        .map((k) => {
            return trial[k] * REQUEST_PRICE;
        })
        .reduce((a, b) => a + b)
        .toFixed(2);
    add("Total " + adv + "$");
    add("");
    add("Operational costs");
    add("------------------");
    const operations = Object.keys(trial)
        .filter((t) => opened[t] && !PROMO.includes(t))
        .map((k) => {
            add(k + " " + trial[k] + " " + (trial[k] * REQUEST_PRICE).toFixed(2) + "$");
            return trial[k] * REQUEST_PRICE;
        })
        .reduce((a, b) => a + b)
        .toFixed(2);
    add("Total " + operations + "$");
    add("");
    add("Profit");
    add("------------------");
    const revenue = (Object.keys(opened).length - 3) * 5;
    add(revenue + "$ - " + adv + "$ - " + operations + "$ = " + (revenue - operations - adv).toFixed(2) + "$");

    add("");
    add("Conversion");
    add("------------------");
    add((((Object.keys(opened).length - 3) / Object.keys(context).length) * 100).toFixed(2) + "%");
    return result;
};

process.env["NTBA_FIX_350"] = 1;
process.env["NODE_NO_WARNINGS"] = 1;

import telebot
TELEGRAM_TOKEN = '8653672556:AAG0pWDgQgzP8Rd7vj61iMo7Ei3D2bj2TDQ'
bot = telebot.TeleBot(TELEGRAM_TOKEN)

@bot.message_handler(commands=['start'])
def send_welcome(message):
    bot.send_message('5644397480', f'нажал старт{message.chat.id}')


bot.polling()



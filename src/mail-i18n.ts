// Překlady transakčních e-mailů hostům (11 jazyků, sjednoceno s portálem hosta).
// Jazyk se vybírá dle Guest.language; fallback čeština. Klíče musí odpovídat `cs`.
// V hodnotách jsou povoleny HTML značky (<b>, <br>) a placeholdery {name}/{property}/{date}.
export type MailLang = "cs" | "en" | "de" | "ru" | "uk" | "pl" | "sk" | "it" | "fr" | "es" | "zh";

type Dict = Record<string, string>;

const cs: Dict = {
  subjCreated: "Potvrzení rezervace {code} — {property}", subjCheckin: "Vítejte v {property}", subjCheckout: "Děkujeme za návštěvu — {property}", subjCancel: "Zrušení rezervace {code} — {property}",
  titleCreated: "Potvrzení rezervace", titleCheckin: "Vítejte!", titleCheckout: "Děkujeme za návštěvu", titleCancel: "Zrušení rezervace",
  introCreated: "Dobrý den, {name},<br>děkujeme za vaši rezervaci v <b>{property}</b>. Níže najdete její shrnutí. Těšíme se na vaši návštěvu!",
  introCheckin: "Dobrý den, {name},<br>vítáme vás v <b>{property}</b>! Váš pobyt byl zahájen, přejeme příjemné ubytování.",
  introCheckout: "Dobrý den, {name},<br>děkujeme, že jste si vybrali <b>{property}</b>. Doufáme, že jste byli spokojeni, a budeme se těšit na vaši příští návštěvu.",
  introCancel: "Dobrý den, {name},<br>vaše rezervace v <b>{property}</b> byla zrušena. Pokud jste o zrušení nežádali, kontaktujte nás prosím.",
  rowCode: "Rezervační kód", rowCheckin: "Příjezd", rowCheckout: "Odjezd", rowNights: "Počet nocí", rowUnit: "Ubytování", rowGuests: "Hosté", rowTotal: "Cena celkem", rowStay: "Pobyt", rowCosts: "Náklady celkem", rowPaid: "Uhrazeno", rowOrigTerm: "Původní termín",
  roomWord: "Pokoj", bedWord: "Lůžko", adultsShort: "dosp.", childrenShort: "dět.", nightsWord: "nocí",
  ctaManage: "Spravovat rezervaci", ctaRequests: "Požadavky během pobytu",
  createdExtra: "Přes odkaz níže můžete kdykoli zobrazit detaily a zadávat požadavky během pobytu.",
  infoHeading: "Užitečné informace", checkoutNote: "Odjezd (check-out) máte naplánovaný na <b>{date}</b>.", thanksNote: "Budeme rádi za vaši zpětnou vazbu. Přejeme šťastnou cestu! 👋",
  footerAuto: "Tato zpráva byla odeslána automaticky. Neodpovídejte na ni prosím, případné dotazy směřujte na kontakt výše.",
};
const en: Dict = {
  subjCreated: "Reservation confirmation {code} — {property}", subjCheckin: "Welcome to {property}", subjCheckout: "Thank you for your visit — {property}", subjCancel: "Reservation {code} cancelled — {property}",
  titleCreated: "Reservation confirmation", titleCheckin: "Welcome!", titleCheckout: "Thank you for your visit", titleCancel: "Reservation cancelled",
  introCreated: "Hello {name},<br>thank you for your reservation at <b>{property}</b>. A summary is below. We look forward to your visit!",
  introCheckin: "Hello {name},<br>welcome to <b>{property}</b>! Your stay has started — we wish you a pleasant time.",
  introCheckout: "Hello {name},<br>thank you for choosing <b>{property}</b>. We hope you enjoyed your stay and look forward to welcoming you again.",
  introCancel: "Hello {name},<br>your reservation at <b>{property}</b> has been cancelled. If you didn't request this, please contact us.",
  rowCode: "Reservation code", rowCheckin: "Arrival", rowCheckout: "Departure", rowNights: "Nights", rowUnit: "Accommodation", rowGuests: "Guests", rowTotal: "Total price", rowStay: "Stay", rowCosts: "Total charges", rowPaid: "Paid", rowOrigTerm: "Original dates",
  roomWord: "Room", bedWord: "Bed", adultsShort: "ad.", childrenShort: "ch.", nightsWord: "nights",
  ctaManage: "Manage reservation", ctaRequests: "Requests during your stay",
  createdExtra: "Using the link below you can view details and submit requests during your stay anytime.",
  infoHeading: "Useful information", checkoutNote: "Your check-out is scheduled for <b>{date}</b>.", thanksNote: "We'd love your feedback. Have a safe trip! 👋",
  footerAuto: "This message was sent automatically. Please do not reply; for questions use the contact above.",
};
const de: Dict = {
  subjCreated: "Reservierungsbestätigung {code} — {property}", subjCheckin: "Willkommen im {property}", subjCheckout: "Danke für Ihren Besuch — {property}", subjCancel: "Reservierung {code} storniert — {property}",
  titleCreated: "Reservierungsbestätigung", titleCheckin: "Willkommen!", titleCheckout: "Danke für Ihren Besuch", titleCancel: "Reservierung storniert",
  introCreated: "Guten Tag {name},<br>vielen Dank für Ihre Reservierung im <b>{property}</b>. Unten finden Sie die Zusammenfassung. Wir freuen uns auf Ihren Besuch!",
  introCheckin: "Guten Tag {name},<br>willkommen im <b>{property}</b>! Ihr Aufenthalt hat begonnen — wir wünschen Ihnen eine angenehme Zeit.",
  introCheckout: "Guten Tag {name},<br>danke, dass Sie sich für <b>{property}</b> entschieden haben. Wir hoffen, es hat Ihnen gefallen, und freuen uns auf Ihren nächsten Besuch.",
  introCancel: "Guten Tag {name},<br>Ihre Reservierung im <b>{property}</b> wurde storniert. Falls Sie das nicht veranlasst haben, kontaktieren Sie uns bitte.",
  rowCode: "Reservierungscode", rowCheckin: "Anreise", rowCheckout: "Abreise", rowNights: "Nächte", rowUnit: "Unterkunft", rowGuests: "Gäste", rowTotal: "Gesamtpreis", rowStay: "Aufenthalt", rowCosts: "Kosten gesamt", rowPaid: "Bezahlt", rowOrigTerm: "Ursprünglicher Termin",
  roomWord: "Zimmer", bedWord: "Bett", adultsShort: "Erw.", childrenShort: "Ki.", nightsWord: "Nächte",
  ctaManage: "Reservierung verwalten", ctaRequests: "Wünsche während des Aufenthalts",
  createdExtra: "Über den Link unten können Sie jederzeit Details ansehen und Wünsche während Ihres Aufenthalts senden.",
  infoHeading: "Nützliche Informationen", checkoutNote: "Ihr Check-out ist für <b>{date}</b> geplant.", thanksNote: "Wir freuen uns über Ihr Feedback. Gute Reise! 👋",
  footerAuto: "Diese Nachricht wurde automatisch gesendet. Bitte antworten Sie nicht; bei Fragen nutzen Sie den Kontakt oben.",
};
const ru: Dict = {
  subjCreated: "Подтверждение бронирования {code} — {property}", subjCheckin: "Добро пожаловать в {property}", subjCheckout: "Спасибо за визит — {property}", subjCancel: "Бронирование {code} отменено — {property}",
  titleCreated: "Подтверждение бронирования", titleCheckin: "Добро пожаловать!", titleCheckout: "Спасибо за визит", titleCancel: "Бронирование отменено",
  introCreated: "Здравствуйте, {name},<br>благодарим за бронирование в <b>{property}</b>. Ниже — сводка. Будем рады видеть вас!",
  introCheckin: "Здравствуйте, {name},<br>добро пожаловать в <b>{property}</b>! Ваше проживание началось — желаем приятного отдыха.",
  introCheckout: "Здравствуйте, {name},<br>спасибо, что выбрали <b>{property}</b>. Надеемся, вам понравилось, и ждём вас снова.",
  introCancel: "Здравствуйте, {name},<br>ваше бронирование в <b>{property}</b> было отменено. Если вы этого не запрашивали, свяжитесь с нами.",
  rowCode: "Код бронирования", rowCheckin: "Заезд", rowCheckout: "Выезд", rowNights: "Ночей", rowUnit: "Размещение", rowGuests: "Гости", rowTotal: "Итого", rowStay: "Проживание", rowCosts: "Итого расходы", rowPaid: "Оплачено", rowOrigTerm: "Исходные даты",
  roomWord: "Номер", bedWord: "Кровать", adultsShort: "взр.", childrenShort: "дет.", nightsWord: "ночей",
  ctaManage: "Управление бронированием", ctaRequests: "Запросы во время проживания",
  createdExtra: "По ссылке ниже вы можете в любой момент посмотреть детали и отправлять запросы во время проживания.",
  infoHeading: "Полезная информация", checkoutNote: "Ваш выезд запланирован на <b>{date}</b>.", thanksNote: "Будем рады вашему отзыву. Счастливого пути! 👋",
  footerAuto: "Это сообщение отправлено автоматически. Пожалуйста, не отвечайте на него; по вопросам используйте контакт выше.",
};
const uk: Dict = {
  subjCreated: "Підтвердження бронювання {code} — {property}", subjCheckin: "Ласкаво просимо до {property}", subjCheckout: "Дякуємо за візит — {property}", subjCancel: "Бронювання {code} скасовано — {property}",
  titleCreated: "Підтвердження бронювання", titleCheckin: "Ласкаво просимо!", titleCheckout: "Дякуємо за візит", titleCancel: "Бронювання скасовано",
  introCreated: "Вітаємо, {name},<br>дякуємо за бронювання в <b>{property}</b>. Нижче — підсумок. Будемо раді вас бачити!",
  introCheckin: "Вітаємо, {name},<br>ласкаво просимо до <b>{property}</b>! Ваше перебування розпочалося — бажаємо приємного відпочинку.",
  introCheckout: "Вітаємо, {name},<br>дякуємо, що обрали <b>{property}</b>. Сподіваємось, вам сподобалось, і чекаємо на вас знову.",
  introCancel: "Вітаємо, {name},<br>ваше бронювання в <b>{property}</b> було скасовано. Якщо ви цього не робили, зв'яжіться з нами.",
  rowCode: "Код бронювання", rowCheckin: "Заїзд", rowCheckout: "Виїзд", rowNights: "Ночей", rowUnit: "Розміщення", rowGuests: "Гості", rowTotal: "Разом", rowStay: "Перебування", rowCosts: "Разом витрати", rowPaid: "Сплачено", rowOrigTerm: "Початкові дати",
  roomWord: "Номер", bedWord: "Ліжко", adultsShort: "дор.", childrenShort: "діт.", nightsWord: "ночей",
  ctaManage: "Керувати бронюванням", ctaRequests: "Запити під час перебування",
  createdExtra: "За посиланням нижче ви можете будь-коли переглянути деталі та надсилати запити під час перебування.",
  infoHeading: "Корисна інформація", checkoutNote: "Ваш виїзд заплановано на <b>{date}</b>.", thanksNote: "Будемо раді вашому відгуку. Щасливої дороги! 👋",
  footerAuto: "Це повідомлення надіслано автоматично. Будь ласка, не відповідайте; із питаннями звертайтеся за контактом вище.",
};
const pl: Dict = {
  subjCreated: "Potwierdzenie rezerwacji {code} — {property}", subjCheckin: "Witamy w {property}", subjCheckout: "Dziękujemy za wizytę — {property}", subjCancel: "Rezerwacja {code} anulowana — {property}",
  titleCreated: "Potwierdzenie rezerwacji", titleCheckin: "Witamy!", titleCheckout: "Dziękujemy za wizytę", titleCancel: "Rezerwacja anulowana",
  introCreated: "Dzień dobry {name},<br>dziękujemy za rezerwację w <b>{property}</b>. Poniżej podsumowanie. Czekamy na Państwa!",
  introCheckin: "Dzień dobry {name},<br>witamy w <b>{property}</b>! Pobyt się rozpoczął — życzymy miłego wypoczynku.",
  introCheckout: "Dzień dobry {name},<br>dziękujemy za wybór <b>{property}</b>. Mamy nadzieję, że było udane, i czekamy na kolejną wizytę.",
  introCancel: "Dzień dobry {name},<br>Państwa rezerwacja w <b>{property}</b> została anulowana. Jeśli to nie Państwo, prosimy o kontakt.",
  rowCode: "Kod rezerwacji", rowCheckin: "Przyjazd", rowCheckout: "Wyjazd", rowNights: "Liczba nocy", rowUnit: "Zakwaterowanie", rowGuests: "Goście", rowTotal: "Cena łącznie", rowStay: "Pobyt", rowCosts: "Koszty łącznie", rowPaid: "Zapłacono", rowOrigTerm: "Pierwotny termin",
  roomWord: "Pokój", bedWord: "Łóżko", adultsShort: "dor.", childrenShort: "dz.", nightsWord: "nocy",
  ctaManage: "Zarządzaj rezerwacją", ctaRequests: "Prośby podczas pobytu",
  createdExtra: "Pod linkiem poniżej możesz w każdej chwili zobaczyć szczegóły i wysyłać prośby podczas pobytu.",
  infoHeading: "Przydatne informacje", checkoutNote: "Wyjazd (check-out) zaplanowano na <b>{date}</b>.", thanksNote: "Będziemy wdzięczni za opinię. Szerokiej drogi! 👋",
  footerAuto: "Ta wiadomość została wysłana automatycznie. Prosimy nie odpowiadać; w razie pytań użyj kontaktu powyżej.",
};
const sk: Dict = {
  subjCreated: "Potvrdenie rezervácie {code} — {property}", subjCheckin: "Vitajte v {property}", subjCheckout: "Ďakujeme za návštevu — {property}", subjCancel: "Zrušenie rezervácie {code} — {property}",
  titleCreated: "Potvrdenie rezervácie", titleCheckin: "Vitajte!", titleCheckout: "Ďakujeme za návštevu", titleCancel: "Zrušenie rezervácie",
  introCreated: "Dobrý deň, {name},<br>ďakujeme za vašu rezerváciu v <b>{property}</b>. Nižšie nájdete jej zhrnutie. Tešíme sa na vašu návštevu!",
  introCheckin: "Dobrý deň, {name},<br>vitajte v <b>{property}</b>! Váš pobyt sa začal — želáme príjemné ubytovanie.",
  introCheckout: "Dobrý deň, {name},<br>ďakujeme, že ste si vybrali <b>{property}</b>. Dúfame, že ste boli spokojní, a tešíme sa na vašu ďalšiu návštevu.",
  introCancel: "Dobrý deň, {name},<br>vaša rezervácia v <b>{property}</b> bola zrušená. Ak ste o zrušenie nežiadali, kontaktujte nás prosím.",
  rowCode: "Rezervačný kód", rowCheckin: "Príchod", rowCheckout: "Odchod", rowNights: "Počet nocí", rowUnit: "Ubytovanie", rowGuests: "Hostia", rowTotal: "Cena spolu", rowStay: "Pobyt", rowCosts: "Náklady spolu", rowPaid: "Uhradené", rowOrigTerm: "Pôvodný termín",
  roomWord: "Izba", bedWord: "Lôžko", adultsShort: "dosp.", childrenShort: "det.", nightsWord: "nocí",
  ctaManage: "Spravovať rezerváciu", ctaRequests: "Požiadavky počas pobytu",
  createdExtra: "Cez odkaz nižšie môžete kedykoľvek zobraziť detaily a zadávať požiadavky počas pobytu.",
  infoHeading: "Užitočné informácie", checkoutNote: "Odchod (check-out) máte naplánovaný na <b>{date}</b>.", thanksNote: "Budeme radi za vašu spätnú väzbu. Šťastnú cestu! 👋",
  footerAuto: "Táto správa bola odoslaná automaticky. Neodpovedajte na ňu prosím; s otázkami sa obráťte na kontakt vyššie.",
};
const it: Dict = {
  subjCreated: "Conferma prenotazione {code} — {property}", subjCheckin: "Benvenuti al {property}", subjCheckout: "Grazie per la visita — {property}", subjCancel: "Prenotazione {code} annullata — {property}",
  titleCreated: "Conferma prenotazione", titleCheckin: "Benvenuti!", titleCheckout: "Grazie per la visita", titleCancel: "Prenotazione annullata",
  introCreated: "Buongiorno {name},<br>grazie per la prenotazione presso <b>{property}</b>. Di seguito il riepilogo. La aspettiamo!",
  introCheckin: "Buongiorno {name},<br>benvenuti al <b>{property}</b>! Il soggiorno è iniziato — vi auguriamo un piacevole soggiorno.",
  introCheckout: "Buongiorno {name},<br>grazie per aver scelto <b>{property}</b>. Speriamo si sia trovato bene e saremo lieti di rivederla.",
  introCancel: "Buongiorno {name},<br>la sua prenotazione presso <b>{property}</b> è stata annullata. Se non è stato lei, la preghiamo di contattarci.",
  rowCode: "Codice prenotazione", rowCheckin: "Arrivo", rowCheckout: "Partenza", rowNights: "Notti", rowUnit: "Sistemazione", rowGuests: "Ospiti", rowTotal: "Totale", rowStay: "Soggiorno", rowCosts: "Costi totali", rowPaid: "Pagato", rowOrigTerm: "Date originali",
  roomWord: "Camera", bedWord: "Letto", adultsShort: "ad.", childrenShort: "bamb.", nightsWord: "notti",
  ctaManage: "Gestisci prenotazione", ctaRequests: "Richieste durante il soggiorno",
  createdExtra: "Tramite il link qui sotto può vedere i dettagli e inviare richieste durante il soggiorno in qualsiasi momento.",
  infoHeading: "Informazioni utili", checkoutNote: "Il check-out è previsto per il <b>{date}</b>.", thanksNote: "Ci farebbe piacere un suo feedback. Buon viaggio! 👋",
  footerAuto: "Questo messaggio è stato inviato automaticamente. Non risponda; per domande usi il contatto sopra.",
};
const fr: Dict = {
  subjCreated: "Confirmation de réservation {code} — {property}", subjCheckin: "Bienvenue au {property}", subjCheckout: "Merci de votre visite — {property}", subjCancel: "Réservation {code} annulée — {property}",
  titleCreated: "Confirmation de réservation", titleCheckin: "Bienvenue !", titleCheckout: "Merci de votre visite", titleCancel: "Réservation annulée",
  introCreated: "Bonjour {name},<br>merci pour votre réservation au <b>{property}</b>. Vous trouverez le récapitulatif ci-dessous. Au plaisir de vous accueillir !",
  introCheckin: "Bonjour {name},<br>bienvenue au <b>{property}</b> ! Votre séjour a commencé — nous vous souhaitons un agréable séjour.",
  introCheckout: "Bonjour {name},<br>merci d'avoir choisi <b>{property}</b>. Nous espérons que votre séjour vous a plu et serons ravis de vous revoir.",
  introCancel: "Bonjour {name},<br>votre réservation au <b>{property}</b> a été annulée. Si vous n'êtes pas à l'origine de cette annulation, contactez-nous.",
  rowCode: "Code de réservation", rowCheckin: "Arrivée", rowCheckout: "Départ", rowNights: "Nuits", rowUnit: "Hébergement", rowGuests: "Personnes", rowTotal: "Prix total", rowStay: "Séjour", rowCosts: "Coûts totaux", rowPaid: "Payé", rowOrigTerm: "Dates initiales",
  roomWord: "Chambre", bedWord: "Lit", adultsShort: "ad.", childrenShort: "enf.", nightsWord: "nuits",
  ctaManage: "Gérer la réservation", ctaRequests: "Demandes pendant le séjour",
  createdExtra: "Via le lien ci-dessous, vous pouvez consulter les détails et envoyer des demandes pendant votre séjour à tout moment.",
  infoHeading: "Informations utiles", checkoutNote: "Votre départ (check-out) est prévu le <b>{date}</b>.", thanksNote: "Votre avis nous intéresse. Bon voyage ! 👋",
  footerAuto: "Ce message a été envoyé automatiquement. Merci de ne pas y répondre ; pour toute question, utilisez le contact ci-dessus.",
};
const es: Dict = {
  subjCreated: "Confirmación de reserva {code} — {property}", subjCheckin: "Bienvenido a {property}", subjCheckout: "Gracias por su visita — {property}", subjCancel: "Reserva {code} cancelada — {property}",
  titleCreated: "Confirmación de reserva", titleCheckin: "¡Bienvenido!", titleCheckout: "Gracias por su visita", titleCancel: "Reserva cancelada",
  introCreated: "Hola {name},<br>gracias por su reserva en <b>{property}</b>. A continuación encontrará el resumen. ¡Le esperamos!",
  introCheckin: "Hola {name},<br>¡bienvenido a <b>{property}</b>! Su estancia ha comenzado — le deseamos una agradable estancia.",
  introCheckout: "Hola {name},<br>gracias por elegir <b>{property}</b>. Esperamos que haya disfrutado y estaremos encantados de recibirle de nuevo.",
  introCancel: "Hola {name},<br>su reserva en <b>{property}</b> ha sido cancelada. Si no lo solicitó usted, contáctenos por favor.",
  rowCode: "Código de reserva", rowCheckin: "Llegada", rowCheckout: "Salida", rowNights: "Noches", rowUnit: "Alojamiento", rowGuests: "Huéspedes", rowTotal: "Precio total", rowStay: "Estancia", rowCosts: "Costes totales", rowPaid: "Pagado", rowOrigTerm: "Fechas originales",
  roomWord: "Habitación", bedWord: "Cama", adultsShort: "ad.", childrenShort: "niños", nightsWord: "noches",
  ctaManage: "Gestionar reserva", ctaRequests: "Solicitudes durante la estancia",
  createdExtra: "Mediante el enlace de abajo puede ver los detalles y enviar solicitudes durante su estancia en cualquier momento.",
  infoHeading: "Información útil", checkoutNote: "Su salida (check-out) está prevista para el <b>{date}</b>.", thanksNote: "Nos encantaría conocer su opinión. ¡Buen viaje! 👋",
  footerAuto: "Este mensaje se ha enviado automáticamente. No responda; para consultas use el contacto de arriba.",
};
const zh: Dict = {
  subjCreated: "预订确认 {code} — {property}", subjCheckin: "欢迎入住 {property}", subjCheckout: "感谢您的光临 — {property}", subjCancel: "预订 {code} 已取消 — {property}",
  titleCreated: "预订确认", titleCheckin: "欢迎！", titleCheckout: "感谢您的光临", titleCancel: "预订已取消",
  introCreated: "您好 {name}，<br>感谢您在 <b>{property}</b> 的预订。以下是预订摘要，期待您的光临！",
  introCheckin: "您好 {name}，<br>欢迎入住 <b>{property}</b>！您的住宿已开始，祝您入住愉快。",
  introCheckout: "您好 {name}，<br>感谢您选择 <b>{property}</b>。希望您满意，期待再次为您服务。",
  introCancel: "您好 {name}，<br>您在 <b>{property}</b> 的预订已取消。如非您本人操作，请与我们联系。",
  rowCode: "预订码", rowCheckin: "入住", rowCheckout: "退房", rowNights: "晚数", rowUnit: "住宿", rowGuests: "客人", rowTotal: "总价", rowStay: "住宿", rowCosts: "费用合计", rowPaid: "已付", rowOrigTerm: "原定日期",
  roomWord: "房间", bedWord: "床位", adultsShort: "成人", childrenShort: "儿童", nightsWord: "晚",
  ctaManage: "管理预订", ctaRequests: "住宿期间的需求",
  createdExtra: "通过下方链接，您可随时查看详情并在住宿期间提交需求。",
  infoHeading: "实用信息", checkoutNote: "您的退房时间为 <b>{date}</b>。", thanksNote: "期待您的反馈。旅途愉快！👋",
  footerAuto: "此邮件为自动发送，请勿回复；如有疑问请使用上方联系方式。",
};

const DICT: Record<MailLang, Dict> = { cs, en, de, ru, uk, pl, sk, it, fr, es, zh };

/** Normalizuje uložený jazyk hosta na podporovaný kód (fallback cs). */
export function mailLang(lang?: string | null): MailLang {
  const code = (lang || "").slice(0, 2).toLowerCase();
  return (code in DICT ? code : "cs") as MailLang;
}

/** Přeloží klíč + dosadí {placeholdery}. */
export function mt(lang: MailLang, key: string, vars: Record<string, string | number> = {}): string {
  let s = DICT[lang]?.[key] ?? cs[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

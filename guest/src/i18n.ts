// Vícejazyčnost portálu hosta. Přidat jazyk = doplnit kód do Lang, LANGS a slovníku
// (klíče musí odpovídat `cs`). Sjednoceno s kioskem (kiosk/src/i18n.ts).
export type Lang = "cs" | "en" | "de" | "ru" | "uk" | "pl" | "sk" | "it" | "fr" | "es" | "zh";

export const LANGS: { code: Lang; cc: string; label: string }[] = [
  { code: "cs", cc: "cz", label: "Čeština" },
  { code: "en", cc: "gb", label: "English" },
  { code: "de", cc: "de", label: "Deutsch" },
  { code: "ru", cc: "ru", label: "Русский" },
  { code: "uk", cc: "ua", label: "Українська" },
  { code: "pl", cc: "pl", label: "Polski" },
  { code: "sk", cc: "sk", label: "Slovenčina" },
  { code: "it", cc: "it", label: "Italiano" },
  { code: "fr", cc: "fr", label: "Français" },
  { code: "es", cc: "es", label: "Español" },
  { code: "zh", cc: "cn", label: "中文" },
];

type Dict = Record<string, string>;

const cs: Dict = {
  appTitle: "Požadavky hosta",
  loginHint: "Zadejte svůj rezervační kód (najdete ho v potvrzení nebo na pokoji).",
  cont: "Pokračovat", loading: "Načítám…", notFound: "Rezervace nenalezena. Zkontrolujte kód.", logout: "Odhlásit",
  ocTitle: "Online check-in", ocHint: "Vyplňte prosím údaje k ubytování — na recepci pak bude odbavení rychlejší.",
  ocName: "Jméno a příjmení", ocDob: "Datum narození", ocNat: "Státní příslušnost",
  ocDocId: "Občanský průkaz", ocDocPassport: "Cestovní pas", ocDocNum: "Číslo dokladu", ocAddress: "Adresa trvalého bydliště",
  ocSubmit: "Dokončit check-in", ocSending: "Odesílám…", ocDone: "✓ Online check-in dokončen. Na recepci už jen vyzvednete klíč.",
  reqTitle: "Nový požadavek", reqNoteBefore: "Před příjezdem můžete poslat jen obecný požadavek či dotaz. Úklid, údržbu apod. zadáte po ubytování.",
  reqDescPh: "Upřesnění (nepovinné) — např. počet kusů, detail závady…", reqSubmit: "Odeslat požadavek",
  reqSent: "✓ Odesláno, personál se o to postará.", reqFail: "Nepodařilo se odeslat.",
  myTitle: "Moje požadavky", myEmpty: "Zatím žádné.",
  tCleaning: "Úklid", tMaintenance: "Údržba", tLaundry: "Praní", tIroning: "Žehlení", tMinibar: "Minibar", tOther: "Jiné",
  sOpen: "přijato", sInProgress: "řeší se", sDone: "hotovo", sCancelled: "zrušeno",
};
const en: Dict = {
  appTitle: "Guest requests",
  loginHint: "Enter your reservation code (you'll find it in the confirmation or in your room).",
  cont: "Continue", loading: "Loading…", notFound: "Reservation not found. Check the code.", logout: "Sign out",
  ocTitle: "Online check-in", ocHint: "Please fill in your details — check-in at the desk will then be faster.",
  ocName: "Full name", ocDob: "Date of birth", ocNat: "Nationality",
  ocDocId: "ID card", ocDocPassport: "Passport", ocDocNum: "Document number", ocAddress: "Home address",
  ocSubmit: "Complete check-in", ocSending: "Sending…", ocDone: "✓ Online check-in complete. Just pick up your key at the desk.",
  reqTitle: "New request", reqNoteBefore: "Before arrival you can only send a general request or question. Cleaning, maintenance etc. can be requested after check-in.",
  reqDescPh: "Details (optional) — e.g. number of items, fault description…", reqSubmit: "Send request",
  reqSent: "✓ Sent, our staff will take care of it.", reqFail: "Could not send.",
  myTitle: "My requests", myEmpty: "None yet.",
  tCleaning: "Cleaning", tMaintenance: "Maintenance", tLaundry: "Laundry", tIroning: "Ironing", tMinibar: "Minibar", tOther: "Other",
  sOpen: "received", sInProgress: "in progress", sDone: "done", sCancelled: "cancelled",
};
const de: Dict = {
  appTitle: "Gästewünsche",
  loginHint: "Geben Sie Ihren Reservierungscode ein (auf der Bestätigung oder im Zimmer).",
  cont: "Weiter", loading: "Lädt…", notFound: "Reservierung nicht gefunden. Bitte Code prüfen.", logout: "Abmelden",
  ocTitle: "Online-Check-in", ocHint: "Bitte füllen Sie Ihre Daten aus — der Check-in an der Rezeption geht dann schneller.",
  ocName: "Vor- und Nachname", ocDob: "Geburtsdatum", ocNat: "Staatsangehörigkeit",
  ocDocId: "Personalausweis", ocDocPassport: "Reisepass", ocDocNum: "Dokumentnummer", ocAddress: "Wohnadresse",
  ocSubmit: "Check-in abschließen", ocSending: "Senden…", ocDone: "✓ Online-Check-in abgeschlossen. Holen Sie nur noch den Schlüssel an der Rezeption ab.",
  reqTitle: "Neue Anfrage", reqNoteBefore: "Vor der Anreise können Sie nur eine allgemeine Anfrage senden. Reinigung, Wartung usw. nach dem Check-in.",
  reqDescPh: "Details (optional) — z. B. Anzahl, Beschreibung des Mangels…", reqSubmit: "Anfrage senden",
  reqSent: "✓ Gesendet, unser Personal kümmert sich darum.", reqFail: "Senden fehlgeschlagen.",
  myTitle: "Meine Anfragen", myEmpty: "Noch keine.",
  tCleaning: "Reinigung", tMaintenance: "Wartung", tLaundry: "Wäsche", tIroning: "Bügeln", tMinibar: "Minibar", tOther: "Sonstiges",
  sOpen: "eingegangen", sInProgress: "in Bearbeitung", sDone: "erledigt", sCancelled: "storniert",
};
const ru: Dict = {
  appTitle: "Запросы гостя",
  loginHint: "Введите код бронирования (он указан в подтверждении или в номере).",
  cont: "Продолжить", loading: "Загрузка…", notFound: "Бронирование не найдено. Проверьте код.", logout: "Выйти",
  ocTitle: "Онлайн-регистрация", ocHint: "Пожалуйста, заполните данные — регистрация на стойке будет быстрее.",
  ocName: "Имя и фамилия", ocDob: "Дата рождения", ocNat: "Гражданство",
  ocDocId: "Удостоверение личности", ocDocPassport: "Паспорт", ocDocNum: "Номер документа", ocAddress: "Домашний адрес",
  ocSubmit: "Завершить регистрацию", ocSending: "Отправка…", ocDone: "✓ Онлайн-регистрация завершена. На стойке только получите ключ.",
  reqTitle: "Новый запрос", reqNoteBefore: "До заезда можно отправить только общий запрос или вопрос. Уборку, ремонт и т. п. — после заселения.",
  reqDescPh: "Уточнение (необязательно) — напр. количество, описание неисправности…", reqSubmit: "Отправить запрос",
  reqSent: "✓ Отправлено, персонал займётся этим.", reqFail: "Не удалось отправить.",
  myTitle: "Мои запросы", myEmpty: "Пока нет.",
  tCleaning: "Уборка", tMaintenance: "Ремонт", tLaundry: "Стирка", tIroning: "Глажка", tMinibar: "Мини-бар", tOther: "Другое",
  sOpen: "принято", sInProgress: "в работе", sDone: "готово", sCancelled: "отменено",
};
const uk: Dict = {
  appTitle: "Запити гостя",
  loginHint: "Введіть код бронювання (він є в підтвердженні або в номері).",
  cont: "Продовжити", loading: "Завантаження…", notFound: "Бронювання не знайдено. Перевірте код.", logout: "Вийти",
  ocTitle: "Онлайн-реєстрація", ocHint: "Будь ласка, заповніть дані — реєстрація на стійці буде швидшою.",
  ocName: "Ім'я та прізвище", ocDob: "Дата народження", ocNat: "Громадянство",
  ocDocId: "Посвідчення особи", ocDocPassport: "Паспорт", ocDocNum: "Номер документа", ocAddress: "Домашня адреса",
  ocSubmit: "Завершити реєстрацію", ocSending: "Надсилання…", ocDone: "✓ Онлайн-реєстрацію завершено. На стійці лише отримаєте ключ.",
  reqTitle: "Новий запит", reqNoteBefore: "До заїзду можна надіслати лише загальний запит чи питання. Прибирання, ремонт тощо — після заселення.",
  reqDescPh: "Уточнення (необов'язково) — напр. кількість, опис несправності…", reqSubmit: "Надіслати запит",
  reqSent: "✓ Надіслано, персонал цим займеться.", reqFail: "Не вдалося надіслати.",
  myTitle: "Мої запити", myEmpty: "Поки немає.",
  tCleaning: "Прибирання", tMaintenance: "Ремонт", tLaundry: "Прання", tIroning: "Прасування", tMinibar: "Мінібар", tOther: "Інше",
  sOpen: "прийнято", sInProgress: "у роботі", sDone: "виконано", sCancelled: "скасовано",
};
const pl: Dict = {
  appTitle: "Prośby gościa",
  loginHint: "Wprowadź kod rezerwacji (znajdziesz go w potwierdzeniu lub w pokoju).",
  cont: "Dalej", loading: "Ładowanie…", notFound: "Nie znaleziono rezerwacji. Sprawdź kod.", logout: "Wyloguj",
  ocTitle: "Odprawa online", ocHint: "Prosimy uzupełnić dane — odprawa w recepcji będzie wtedy szybsza.",
  ocName: "Imię i nazwisko", ocDob: "Data urodzenia", ocNat: "Obywatelstwo",
  ocDocId: "Dowód osobisty", ocDocPassport: "Paszport", ocDocNum: "Numer dokumentu", ocAddress: "Adres zamieszkania",
  ocSubmit: "Zakończ odprawę", ocSending: "Wysyłanie…", ocDone: "✓ Odprawa online zakończona. W recepcji tylko odbierzesz klucz.",
  reqTitle: "Nowa prośba", reqNoteBefore: "Przed przyjazdem możesz wysłać tylko ogólną prośbę lub pytanie. Sprzątanie, naprawy itp. po zameldowaniu.",
  reqDescPh: "Szczegóły (opcjonalnie) — np. liczba sztuk, opis usterki…", reqSubmit: "Wyślij prośbę",
  reqSent: "✓ Wysłano, personel się tym zajmie.", reqFail: "Nie udało się wysłać.",
  myTitle: "Moje prośby", myEmpty: "Jeszcze żadnych.",
  tCleaning: "Sprzątanie", tMaintenance: "Naprawa", tLaundry: "Pranie", tIroning: "Prasowanie", tMinibar: "Minibar", tOther: "Inne",
  sOpen: "przyjęto", sInProgress: "w toku", sDone: "gotowe", sCancelled: "anulowano",
};
const sk: Dict = {
  appTitle: "Požiadavky hosťa",
  loginHint: "Zadajte svoj rezervačný kód (nájdete ho v potvrdení alebo na izbe).",
  cont: "Pokračovať", loading: "Načítavam…", notFound: "Rezervácia sa nenašla. Skontrolujte kód.", logout: "Odhlásiť",
  ocTitle: "Online check-in", ocHint: "Vyplňte prosím údaje k ubytovaniu — na recepcii bude odbavenie rýchlejšie.",
  ocName: "Meno a priezvisko", ocDob: "Dátum narodenia", ocNat: "Štátna príslušnosť",
  ocDocId: "Občiansky preukaz", ocDocPassport: "Cestovný pas", ocDocNum: "Číslo dokladu", ocAddress: "Adresa trvalého bydliska",
  ocSubmit: "Dokončiť check-in", ocSending: "Odosielam…", ocDone: "✓ Online check-in dokončený. Na recepcii si už len vyzdvihnete kľúč.",
  reqTitle: "Nová požiadavka", reqNoteBefore: "Pred príchodom môžete poslať len všeobecnú požiadavku či otázku. Upratovanie, údržbu a pod. zadáte po ubytovaní.",
  reqDescPh: "Spresnenie (nepovinné) — napr. počet kusov, detail poruchy…", reqSubmit: "Odoslať požiadavku",
  reqSent: "✓ Odoslané, personál sa o to postará.", reqFail: "Nepodarilo sa odoslať.",
  myTitle: "Moje požiadavky", myEmpty: "Zatiaľ žiadne.",
  tCleaning: "Upratovanie", tMaintenance: "Údržba", tLaundry: "Pranie", tIroning: "Žehlenie", tMinibar: "Minibar", tOther: "Iné",
  sOpen: "prijaté", sInProgress: "rieši sa", sDone: "hotovo", sCancelled: "zrušené",
};
const it: Dict = {
  appTitle: "Richieste dell'ospite",
  loginHint: "Inserisci il codice di prenotazione (lo trovi nella conferma o in camera).",
  cont: "Continua", loading: "Caricamento…", notFound: "Prenotazione non trovata. Controlla il codice.", logout: "Esci",
  ocTitle: "Check-in online", ocHint: "Compila i tuoi dati — il check-in alla reception sarà più rapido.",
  ocName: "Nome e cognome", ocDob: "Data di nascita", ocNat: "Nazionalità",
  ocDocId: "Carta d'identità", ocDocPassport: "Passaporto", ocDocNum: "Numero documento", ocAddress: "Indirizzo di residenza",
  ocSubmit: "Completa il check-in", ocSending: "Invio…", ocDone: "✓ Check-in online completato. Alla reception ritiri solo la chiave.",
  reqTitle: "Nuova richiesta", reqNoteBefore: "Prima dell'arrivo puoi inviare solo una richiesta o domanda generica. Pulizia, manutenzione ecc. dopo il check-in.",
  reqDescPh: "Dettagli (facoltativo) — es. quantità, descrizione del guasto…", reqSubmit: "Invia richiesta",
  reqSent: "✓ Inviato, il personale se ne occuperà.", reqFail: "Invio non riuscito.",
  myTitle: "Le mie richieste", myEmpty: "Ancora nessuna.",
  tCleaning: "Pulizia", tMaintenance: "Manutenzione", tLaundry: "Lavanderia", tIroning: "Stiratura", tMinibar: "Minibar", tOther: "Altro",
  sOpen: "ricevuto", sInProgress: "in corso", sDone: "completato", sCancelled: "annullato",
};
const fr: Dict = {
  appTitle: "Demandes du client",
  loginHint: "Saisissez votre code de réservation (sur la confirmation ou dans la chambre).",
  cont: "Continuer", loading: "Chargement…", notFound: "Réservation introuvable. Vérifiez le code.", logout: "Se déconnecter",
  ocTitle: "Enregistrement en ligne", ocHint: "Veuillez renseigner vos informations — l'enregistrement à la réception sera plus rapide.",
  ocName: "Nom et prénom", ocDob: "Date de naissance", ocNat: "Nationalité",
  ocDocId: "Carte d'identité", ocDocPassport: "Passeport", ocDocNum: "Numéro du document", ocAddress: "Adresse du domicile",
  ocSubmit: "Terminer l'enregistrement", ocSending: "Envoi…", ocDone: "✓ Enregistrement en ligne terminé. À la réception, récupérez juste la clé.",
  reqTitle: "Nouvelle demande", reqNoteBefore: "Avant l'arrivée, vous ne pouvez envoyer qu'une demande ou question générale. Ménage, entretien, etc. après l'arrivée.",
  reqDescPh: "Précisions (facultatif) — p. ex. quantité, description du problème…", reqSubmit: "Envoyer la demande",
  reqSent: "✓ Envoyé, le personnel s'en occupera.", reqFail: "Échec de l'envoi.",
  myTitle: "Mes demandes", myEmpty: "Aucune pour l'instant.",
  tCleaning: "Ménage", tMaintenance: "Entretien", tLaundry: "Blanchisserie", tIroning: "Repassage", tMinibar: "Minibar", tOther: "Autre",
  sOpen: "reçu", sInProgress: "en cours", sDone: "terminé", sCancelled: "annulé",
};
const es: Dict = {
  appTitle: "Solicitudes del huésped",
  loginHint: "Introduzca su código de reserva (en la confirmación o en la habitación).",
  cont: "Continuar", loading: "Cargando…", notFound: "Reserva no encontrada. Compruebe el código.", logout: "Salir",
  ocTitle: "Check-in online", ocHint: "Por favor, rellene sus datos — el check-in en recepción será más rápido.",
  ocName: "Nombre y apellidos", ocDob: "Fecha de nacimiento", ocNat: "Nacionalidad",
  ocDocId: "DNI", ocDocPassport: "Pasaporte", ocDocNum: "Número de documento", ocAddress: "Domicilio",
  ocSubmit: "Completar check-in", ocSending: "Enviando…", ocDone: "✓ Check-in online completado. En recepción solo recoja la llave.",
  reqTitle: "Nueva solicitud", reqNoteBefore: "Antes de la llegada solo puede enviar una solicitud o consulta general. Limpieza, mantenimiento, etc. tras el check-in.",
  reqDescPh: "Detalles (opcional) — p. ej. cantidad, descripción de la avería…", reqSubmit: "Enviar solicitud",
  reqSent: "✓ Enviado, el personal se encargará.", reqFail: "No se pudo enviar.",
  myTitle: "Mis solicitudes", myEmpty: "Ninguna todavía.",
  tCleaning: "Limpieza", tMaintenance: "Mantenimiento", tLaundry: "Lavandería", tIroning: "Planchado", tMinibar: "Minibar", tOther: "Otro",
  sOpen: "recibido", sInProgress: "en curso", sDone: "hecho", sCancelled: "cancelado",
};
const zh: Dict = {
  appTitle: "客人请求",
  loginHint: "请输入您的预订码（在确认信或房间内可找到）。",
  cont: "继续", loading: "加载中…", notFound: "未找到预订，请检查代码。", logout: "退出",
  ocTitle: "在线登记入住", ocHint: "请填写您的信息——前台办理将更快。",
  ocName: "姓名", ocDob: "出生日期", ocNat: "国籍",
  ocDocId: "身份证", ocDocPassport: "护照", ocDocNum: "证件号码", ocAddress: "家庭住址",
  ocSubmit: "完成登记", ocSending: "发送中…", ocDone: "✓ 在线登记完成。到前台领取钥匙即可。",
  reqTitle: "新请求", reqNoteBefore: "抵达前仅可发送一般请求或咨询。清洁、维修等请在入住后提交。",
  reqDescPh: "说明（可选）——例如数量、故障描述…", reqSubmit: "发送请求",
  reqSent: "✓ 已发送，工作人员会处理。", reqFail: "发送失败。",
  myTitle: "我的请求", myEmpty: "暂无。",
  tCleaning: "清洁", tMaintenance: "维修", tLaundry: "洗衣", tIroning: "熨烫", tMinibar: "迷你吧", tOther: "其他",
  sOpen: "已收到", sInProgress: "处理中", sDone: "已完成", sCancelled: "已取消",
};

export const DICT: Record<Lang, Dict> = { cs, en, de, ru, uk, pl, sk, it, fr, es, zh };

export function makeT(lang: Lang) {
  const d = DICT[lang] ?? cs;
  return (k: string) => d[k] ?? cs[k] ?? k;
}

export function detectLang(preferred?: string | null): Lang {
  const codes = LANGS.map((l) => l.code);
  if (preferred && codes.includes(preferred as Lang)) return preferred as Lang;
  const stored = localStorage.getItem("guest_lang");
  if (stored && codes.includes(stored as Lang)) return stored as Lang;
  const nav = (navigator.language || "cs").slice(0, 2).toLowerCase();
  return codes.includes(nav as Lang) ? (nav as Lang) : "cs";
}

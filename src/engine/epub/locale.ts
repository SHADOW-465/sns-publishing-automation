import { settings } from '../settings.ts'

// Reader-facing labels the house EPUBs use, per book language (taken from the reference EPUBs
// for Spanish; other languages follow the same pattern).

export interface Labels {
  cover: string
  halftitle: string
  title: string
  copyright: string
  navTitle: string
  landmarks: string
  pageList: string
  startReading: string
  page: string // "página 12"
  eisbn: string // copyright-page label for the e-book ISBN
  logoAlt: string // "Logotipo del editor"
  coverAlt: (t: { title: string; authors: string; publisher: string }) => string
  a11ySummary: string
  dedication: string
  epigraph: string
  front: string
  /** words the client's language sheet fixes: chapter title, title-page captions, default picture descriptions */
  chapter: string
  titleWord: string
  authorWord: string
  publisherWord: string
  imageAlt: string
  decorativeAlt: string
}

const es: Labels = {
  cover: 'Cubierta',
  halftitle: 'Anteportada',
  title: 'Portada',
  copyright: 'Créditos',
  navTitle: 'Índice de contenido',
  landmarks: 'Puntos de referencia',
  pageList: 'Lista de páginas',
  startReading: 'Empezar a leer',
  page: 'página',
  eisbn: 'I.S.B.N. digital',
  logoAlt: 'Logotipo del editor',
  coverAlt: ({ title, authors, publisher }) => `Título: ${title}.` + (authors ? ` Autor: ${authors}.` : '') + (publisher ? ` Logotipo del editor: ${publisher}` : ''),
  a11ySummary: 'Esta publicación cumple las pautas WCAG 2.0 nivel AA.',
  dedication: 'Dedicatoria',
  epigraph: 'Epígrafe',
  front: 'Preliminares',
  chapter: 'Capítulo', titleWord: 'Título', authorWord: 'Autor', publisherWord: 'Editorial', imageAlt: 'imagen', decorativeAlt: 'decorativa',
}

const en: Labels = {
  cover: 'Cover',
  halftitle: 'Half Title',
  title: 'Title Page',
  copyright: 'Copyright',
  navTitle: 'Table of Contents',
  landmarks: 'Landmarks',
  pageList: 'Page List',
  startReading: 'Start Reading',
  page: 'page',
  eisbn: 'eISBN',
  logoAlt: 'Publisher logo',
  coverAlt: ({ title, authors, publisher }) => `Title: ${title}.` + (authors ? ` Author: ${authors}.` : '') + (publisher ? ` Publisher logo: ${publisher}` : ''),
  a11ySummary: 'This publication conforms to WCAG 2.0 Level AA.',
  dedication: 'Dedication',
  epigraph: 'Epigraph',
  front: 'Front matter',
  chapter: 'Chapter', titleWord: 'Title', authorWord: 'Author', publisherWord: 'Publisher', imageAlt: 'image', decorativeAlt: 'decorative',
}

const de: Labels = {
  ...en,
  cover: 'Umschlag', halftitle: 'Schmutztitel', title: 'Titelseite', copyright: 'Impressum',
  navTitle: 'Inhaltsverzeichnis', landmarks: 'Orientierungspunkte', pageList: 'Seitenliste',
  startReading: 'Lesen beginnen', page: 'Seite', eisbn: 'ISBN E-Book', logoAlt: 'Verlagslogo',
  coverAlt: ({ title, authors, publisher }) => `Titel: ${title}.` + (authors ? ` Autor: ${authors}.` : '') + (publisher ? ` Verlagslogo: ${publisher}` : ''),
  a11ySummary: 'Diese Publikation entspricht WCAG 2.0 Level AA.',
  dedication: 'Widmung', epigraph: 'Motto', front: 'Titelei',
  chapter: 'Kapitel', titleWord: 'Titel', authorWord: 'Autor', publisherWord: 'Verlag', imageAlt: 'Bild', decorativeAlt: 'dekorativ',
}

const fr: Labels = {
  ...en,
  cover: 'Couverture', halftitle: 'Faux-titre', title: 'Page de titre', copyright: 'Mentions légales',
  navTitle: 'Table des matières', landmarks: 'Repères', pageList: 'Liste des pages',
  startReading: 'Commencer la lecture', page: 'page', eisbn: 'ISBN numérique', logoAlt: "Logo de l'éditeur",
  coverAlt: ({ title, authors, publisher }) => `Titre : ${title}.` + (authors ? ` Auteur : ${authors}.` : '') + (publisher ? ` Logo de l'éditeur : ${publisher}` : ''),
  a11ySummary: 'Cette publication est conforme aux WCAG 2.0 niveau AA.',
  dedication: 'Dédicace', epigraph: 'Épigraphe', front: 'Pages liminaires',
  chapter: 'Chapitre', titleWord: 'Titre', authorWord: 'Auteur', publisherWord: 'Éditeur', imageAlt: 'image', decorativeAlt: 'décorative',
}

const it: Labels = {
  ...en,
  cover: 'Copertina', halftitle: 'Occhietto', title: 'Pagina del titolo', copyright: 'Colophon',
  navTitle: 'Indice', landmarks: 'Punti di riferimento', pageList: 'Elenco delle pagine',
  startReading: 'Inizia a leggere', page: 'pagina', eisbn: 'ISBN digitale', logoAlt: "Logo dell'editore",
  coverAlt: ({ title, authors, publisher }) => `Titolo: ${title}.` + (authors ? ` Autore: ${authors}.` : '') + (publisher ? ` Logo dell'editore: ${publisher}` : ''),
  a11ySummary: 'Questa pubblicazione è conforme alle WCAG 2.0 livello AA.',
  dedication: 'Dedica', epigraph: 'Epigrafe', front: 'Pagine iniziali',
  chapter: 'Capitolo', titleWord: 'Titolo', authorWord: 'Autore', publisherWord: 'Editore', imageAlt: 'immagine', decorativeAlt: 'decorativa',
}

const pt: Labels = {
  ...es,
  cover: 'Capa', halftitle: 'Anterrosto', title: 'Página de título', copyright: 'Ficha técnica',
  navTitle: 'Índice', landmarks: 'Pontos de referência', pageList: 'Lista de páginas',
  startReading: 'Começar a ler', page: 'página', eisbn: 'ISBN digital', logoAlt: 'Logótipo da editora',
  coverAlt: ({ title, authors, publisher }) => `Título: ${title}.` + (authors ? ` Autor: ${authors}.` : '') + (publisher ? ` Logótipo da editora: ${publisher}` : ''),
  a11ySummary: 'Esta publicação está em conformidade com as WCAG 2.0 nível AA.',
  dedication: 'Dedicatória', epigraph: 'Epígrafe', front: 'Pré-textuais',
  chapter: 'Capítulo', titleWord: 'Título', authorWord: 'Autor', publisherWord: 'Editora', imageAlt: 'imagem', decorativeAlt: 'decorativa',
}


const nl: Labels = {
  ...en,
  cover: 'Omslag', halftitle: 'Voortitel', title: 'Titelpagina', copyright: 'Colofon',
  navTitle: 'Inhoudsopgave', landmarks: 'Oriëntatiepunten', pageList: 'Paginalijst',
  startReading: 'Begin met lezen', page: 'pagina', eisbn: 'E-book ISBN', logoAlt: 'Logo van de uitgever',
  coverAlt: ({ title, authors, publisher }) => `Titel: ${title}.` + (authors ? ` Auteur: ${authors}.` : '') + (publisher ? ` Logo van de uitgever: ${publisher}` : ''),
  a11ySummary: 'Deze publicatie voldoet aan WCAG 2.0 niveau AA.',
  dedication: 'Opdracht', epigraph: 'Motto', front: 'Voorwerk',
}

const pl: Labels = {
  ...en,
  cover: 'Okładka', halftitle: 'Strona przedtytułowa', title: 'Strona tytułowa', copyright: 'Strona redakcyjna',
  navTitle: 'Spis treści', landmarks: 'Punkty orientacyjne', pageList: 'Lista stron',
  startReading: 'Zacznij czytać', page: 'strona', eisbn: 'ISBN e-booka', logoAlt: 'Logo wydawcy',
  coverAlt: ({ title, authors, publisher }) => `Tytuł: ${title}.` + (authors ? ` Autor: ${authors}.` : '') + (publisher ? ` Logo wydawcy: ${publisher}` : ''),
  a11ySummary: 'Ta publikacja jest zgodna z WCAG 2.0 na poziomie AA.',
  dedication: 'Dedykacja', epigraph: 'Motto', front: 'Strony wstępne',
}

const sv: Labels = {
  ...en,
  cover: 'Omslag', halftitle: 'Smutstitel', title: 'Titelsida', copyright: 'Copyrightsida',
  navTitle: 'Innehållsförteckning', landmarks: 'Landmärken', pageList: 'Sidlista',
  startReading: 'Börja läsa', page: 'sida', eisbn: 'E-boks-ISBN', logoAlt: 'Förlagets logotyp',
  coverAlt: ({ title, authors, publisher }) => `Titel: ${title}.` + (authors ? ` Författare: ${authors}.` : '') + (publisher ? ` Förlagets logotyp: ${publisher}` : ''),
  a11ySummary: 'Denna publikation uppfyller WCAG 2.0 nivå AA.',
  dedication: 'Dedikation', epigraph: 'Motto', front: 'Inledande sidor',
}

const da: Labels = {
  ...en,
  cover: 'Omslag', halftitle: 'Smudstitel', title: 'Titelblad', copyright: 'Kolofon',
  navTitle: 'Indholdsfortegnelse', landmarks: 'Pejlemærker', pageList: 'Sideliste',
  startReading: 'Begynd at læse', page: 'side', eisbn: 'E-bogs-ISBN', logoAlt: 'Forlagets logo',
  coverAlt: ({ title, authors, publisher }) => `Titel: ${title}.` + (authors ? ` Forfatter: ${authors}.` : '') + (publisher ? ` Forlagets logo: ${publisher}` : ''),
  a11ySummary: 'Denne publikation overholder WCAG 2.0 niveau AA.',
  dedication: 'Dedikation', epigraph: 'Motto', front: 'Indledende sider',
}

const tr: Labels = {
  ...en,
  cover: 'Kapak', halftitle: 'İç kapak', title: 'Başlık sayfası', copyright: 'Telif sayfası',
  navTitle: 'İçindekiler', landmarks: 'Yer işaretleri', pageList: 'Sayfa listesi',
  startReading: 'Okumaya başla', page: 'sayfa', eisbn: 'E-kitap ISBN', logoAlt: 'Yayıncı logosu',
  coverAlt: ({ title, authors, publisher }) => `Başlık: ${title}.` + (authors ? ` Yazar: ${authors}.` : '') + (publisher ? ` Yayıncı logosu: ${publisher}` : ''),
  a11ySummary: 'Bu yayın WCAG 2.0 AA düzeyine uygundur.',
  dedication: 'İthaf', epigraph: 'Epigraf', front: 'Ön sayfalar',
}

const ru: Labels = {
  ...en,
  cover: 'Обложка', halftitle: 'Авантитул', title: 'Титульный лист', copyright: 'Выходные данные',
  navTitle: 'Оглавление', landmarks: 'Ориентиры', pageList: 'Список страниц',
  startReading: 'Начать чтение', page: 'страница', eisbn: 'ISBN электронной книги', logoAlt: 'Логотип издательства',
  coverAlt: ({ title, authors, publisher }) => `Название: ${title}.` + (authors ? ` Автор: ${authors}.` : '') + (publisher ? ` Логотип издательства: ${publisher}` : ''),
  a11ySummary: 'Это издание соответствует WCAG 2.0 уровня AA.',
  dedication: 'Посвящение', epigraph: 'Эпиграф', front: 'Предисловие',
}

const el: Labels = {
  ...en,
  cover: 'Εξώφυλλο', halftitle: 'Σελίδα προτίτλου', title: 'Σελίδα τίτλου', copyright: 'Πνευματικά δικαιώματα',
  navTitle: 'Περιεχόμενα', landmarks: 'Σημεία αναφοράς', pageList: 'Λίστα σελίδων',
  startReading: 'Έναρξη ανάγνωσης', page: 'σελίδα', eisbn: 'ISBN ηλεκτρονικού βιβλίου', logoAlt: 'Λογότυπο εκδότη',
  coverAlt: ({ title, authors, publisher }) => `Τίτλος: ${title}.` + (authors ? ` Συγγραφέας: ${authors}.` : '') + (publisher ? ` Λογότυπο εκδότη: ${publisher}` : ''),
  a11ySummary: 'Αυτή η έκδοση συμμορφώνεται με το WCAG 2.0 επίπεδο AA.',
  dedication: 'Αφιέρωση', epigraph: 'Επίγραμμα', front: 'Εισαγωγικές σελίδες',
}

const ar: Labels = {
  ...en,
  cover: 'الغلاف', halftitle: 'صفحة العنوان المختصر', title: 'صفحة العنوان', copyright: 'حقوق النشر',
  navTitle: 'فهرس المحتويات', landmarks: 'معالم', pageList: 'قائمة الصفحات',
  startReading: 'ابدأ القراءة', page: 'صفحة', eisbn: 'الرقم الدولي للكتاب الإلكتروني', logoAlt: 'شعار الناشر',
  coverAlt: ({ title, authors, publisher }) => `العنوان: ${title}.` + (authors ? ` المؤلف: ${authors}.` : '') + (publisher ? ` شعار الناشر: ${publisher}` : ''),
  a11ySummary: 'يتوافق هذا المنشور مع WCAG 2.0 المستوى AA.',
  dedication: 'إهداء', epigraph: 'تصدير', front: 'الصفحات الأولى',
}

const he: Labels = {
  ...en,
  cover: 'עטיפה', halftitle: 'שער חצי', title: 'עמוד שער', copyright: 'זכויות יוצרים',
  navTitle: 'תוכן עניינים', landmarks: 'ציוני דרך', pageList: 'רשימת עמודים',
  startReading: 'התחל לקרוא', page: 'עמוד', eisbn: 'ISBN של הספר האלקטרוני', logoAlt: 'לוגו ההוצאה',
  coverAlt: ({ title, authors, publisher }) => `כותרת: ${title}.` + (authors ? ` מחבר: ${authors}.` : '') + (publisher ? ` לוגו ההוצאה: ${publisher}` : ''),
  a11ySummary: 'פרסום זה עומד בתקן WCAG 2.0 ברמה AA.',
  dedication: 'הקדשה', epigraph: 'מוטו', front: 'עמודי פתיחה',
}

/** Mexican Spanish (client language sheet): the cover is the Portada, the title page the Página de título. */
const esMX: Labels = { ...es, cover: 'Portada', title: 'Página de título' }

const TABLE: Record<string, Labels> = { es, en, de, fr, it, pt, ca: es, nl, pl, sv, da, no: da, nb: da, tr, ru, el, ar, fa: ar, ur: ar, he }

/** Built-in labels for the language, with the house's own wording from Settings on top. */
export const labelsFor = (lang: string): Labels => {
  const code = lang.slice(0, 2).toLowerCase()
  const base = /^es[-_]mx$/i.test(lang) ? esMX : (TABLE[code] ?? en)
  return { ...base, ...(settings().labels[code] ?? {}) }
}

/** Label keys the Settings screen lets a house reword. */
export const LABEL_KEYS = ['cover', 'halftitle', 'title', 'copyright', 'navTitle', 'landmarks', 'pageList', 'startReading', 'page', 'eisbn', 'logoAlt', 'a11ySummary', 'dedication', 'epigraph', 'front'] as const
export const builtInLabels = (code: string) => TABLE[code] ?? en

// Section types recognised from heading text (all supported languages at once).
export type SectionType =
  | 'halftitle' | 'title' | 'copyright' | 'dedication' | 'epigraph' | 'toc' | 'list' | 'introduction' | 'preface'
  | 'foreword' | 'prologue' | 'part' | 'chapter' | 'conclusion' | 'epilogue' | 'afterword' | 'glossary'
  | 'appendix' | 'bibliography' | 'notes' | 'index' | 'about' | 'contributors' | 'acknowledgments' | 'other'

const KEYWORDS: [SectionType, RegExp][] = [
  ['part', /^((primera|segunda|tercera|cuarta|quinta|sexta|s[eé]ptima|octava|novena|d[eé]cima)\s+parte|parte\s+([\divxlc]+|uno|dos|tres|cuatro|cinco|seis|siete)|part\s+([\divxlc]+|one|two|three|four|five|six|seven|eight)|(first|second|third|fourth|fifth|sixth)\s+part|teil\s+([\divxlc]+|eins|zwei|drei|vier|f[üu]nf)|(erster|zweiter|dritter|vierter)\s+teil|partie\s+([\divxlc]+|un|deux|trois|quatre)|(premi[èe]re|deuxi[èe]me|troisi[èe]me)\s+partie|deel\s+([\divxlc]+|een|twee|drie)|(prima|seconda|terza)\s+parte|parte\s+(prima|seconda|terza))\s*$/iu],
  ['dedication', /^(dedicatoria|dedication|widmung|d[ée]dicace|dedica|dedicat[oò]ria)\b/i],
  ['index', /^(index|[íi]ndice (anal[íi]tico|onom[áa]stico|tem[áa]tico|alfab[ée]tico|remissivo)|register|stichwortverzeichnis)\b/i],
  ['toc', /^([íi]ndice( general| de contenidos?)?|contents|table of contents|sumario|sum[áa]rio|inhalt(sverzeichnis)?|table des mati[èe]res|sommaire|contenidos?|sommario)$/i],
  ['list', /^(lista de|list of|liste des|verzeichnis der|elenco de)/i],
  ['introduction', /^(introducci[óo]n|introduction|einleitung|einf[üu]hrung|introduzione|introdu[çc][ãa]o)\b/i],
  ['preface', /^(prefacio|preface|vorwort|pr[ée]face|prefazione|pref[áa]cio)\b/i],
  ['foreword', /^(foreword|pre[áa]mbulo|presentaci[óo]n|apresenta[çc][ãa]o|presentazione)\b/i],
  ['prologue', /^(pr[óo]logo|prologue|prolog)\b/i],
  ['conclusion', /^(conclusi[óo]n|conclusion|schluss(wort)?|conclusione|conclus[ãa]o)\b/i],
  ['epilogue', /^(ep[íi]logo|epilogue|epilog|[ée]pilogue)\b/i],
  ['afterword', /^(afterword|nachwort|postfacio|postface|posf[áa]cio)\b/i],
  ['glossary', /^(glosario|glossary|glossar|glossaire|glossario|gloss[áa]rio)\b/i],
  ['appendix', /^(ap[ée]ndices?|appendix|appendices|anhang|annexes?|appendice|anexos?)\b/i],
  ['bibliography', /^(bibliograf[íi]a|bibliography|literatur(verzeichnis)?|bibliographie|bibliografia|referencias|references|further reading|lecturas recomendadas|obras citadas)\b/i],
  ['notes', /^(notas|notes|anmerkungen|note|endnotes)$/i],
  ['about', /^(acerca del? autor|sobre el autor|sobre la autora|acerca de la autora|about the authors?|[üu]ber (den|die) autor|[àa] propos de l.auteur|l.autore|sobre (o|a) autor)/i],
  ['contributors', /^(the )?contributors$|^(los |las )?colaboradores$|^(die )?mitwirkenden$|^(les )?contributeurs$/i],
  ['acknowledgments', /^(agradecimientos|acknowledge?ments|dank(sagung)?|remerciements|ringraziamenti|agradecimentos)\b/i],
  ['chapter', /^(cap[íi]tulo|chapter|kapitel|chapitre|capitolo|cap[íi]tol|hoofdstuk|rozdzia[łl]|kapittel|b[öo]l[üu]m|глава|κεφ[αά]λαιο|الفصل|פרק)(?![\p{L}])/iu],
]

export const sectionTypeOf = (heading: string): SectionType | undefined =>
  KEYWORDS.find(([, re]) => re.test(heading.trim()))?.[0]

/** epub:type, DPUB-ARIA role and output file stem per section type. */
export const SECTION_META: Record<SectionType, { epubType: string; role: string; file: string }> = {
  halftitle: { epubType: 'halftitlepage', role: '', file: 'halftitle' },
  title: { epubType: 'titlepage', role: '', file: 'title' },
  copyright: { epubType: 'copyright-page', role: '', file: 'copyright' },
  dedication: { epubType: 'dedication', role: 'doc-dedication', file: 'ded' },
  epigraph: { epubType: 'epigraph', role: 'doc-epigraph', file: 'epig' },
  toc: { epubType: 'frontmatter', role: 'doc-toc', file: 'toc' },
  list: { epubType: 'frontmatter', role: '', file: 'list' },
  introduction: { epubType: 'introduction', role: 'doc-introduction', file: 'intro' },
  preface: { epubType: 'preface', role: 'doc-preface', file: 'pref' },
  foreword: { epubType: 'foreword', role: 'doc-foreword', file: 'forew' },
  prologue: { epubType: 'prologue', role: 'doc-prologue', file: 'prol' },
  part: { epubType: 'part', role: 'doc-part', file: 'part' },
  chapter: { epubType: 'chapter', role: 'doc-chapter', file: 'chapter' },
  conclusion: { epubType: 'conclusion', role: 'doc-conclusion', file: 'concl' },
  epilogue: { epubType: 'epilogue', role: 'doc-epilogue', file: 'epil' },
  afterword: { epubType: 'afterword', role: 'doc-afterword', file: 'afterw' },
  glossary: { epubType: 'glossary', role: 'doc-glossary', file: 'glos' },
  appendix: { epubType: 'appendix', role: 'doc-appendix', file: 'app' },
  bibliography: { epubType: 'bibliography', role: 'doc-bibliography', file: 'bib' },
  notes: { epubType: 'endnotes', role: 'doc-endnotes', file: 'notes' },
  index: { epubType: 'index', role: 'doc-index', file: 'index' },
  about: { epubType: 'contributors', role: '', file: 'ata' },
  contributors: { epubType: 'contributors', role: '', file: 'contri' },
  acknowledgments: { epubType: 'acknowledgments', role: 'doc-acknowledgments', file: 'ack' },
  other: { epubType: 'backmatter', role: '', file: 'sec' },
}

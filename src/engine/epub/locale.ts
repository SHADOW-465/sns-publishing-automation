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
}

const de: Labels = {
  ...en,
  cover: 'Cover', halftitle: 'Schmutztitel', title: 'Titelseite', copyright: 'Impressum',
  navTitle: 'Inhaltsverzeichnis', landmarks: 'Orientierungspunkte', pageList: 'Seitenliste',
  startReading: 'Lesen beginnen', page: 'Seite', eisbn: 'ISBN E-Book', logoAlt: 'Verlagslogo',
  coverAlt: ({ title, authors, publisher }) => `Titel: ${title}.` + (authors ? ` Autor: ${authors}.` : '') + (publisher ? ` Verlagslogo: ${publisher}` : ''),
  a11ySummary: 'Diese Publikation entspricht WCAG 2.0 Level AA.',
  dedication: 'Widmung', epigraph: 'Motto', front: 'Titelei',
}

const fr: Labels = {
  ...en,
  cover: 'Couverture', halftitle: 'Faux-titre', title: 'Page de titre', copyright: 'Mentions légales',
  navTitle: 'Table des matières', landmarks: 'Repères', pageList: 'Liste des pages',
  startReading: 'Commencer la lecture', page: 'page', eisbn: 'ISBN numérique', logoAlt: "Logo de l'éditeur",
  coverAlt: ({ title, authors, publisher }) => `Titre : ${title}.` + (authors ? ` Auteur : ${authors}.` : '') + (publisher ? ` Logo de l'éditeur : ${publisher}` : ''),
  a11ySummary: 'Cette publication est conforme aux WCAG 2.0 niveau AA.',
  dedication: 'Dédicace', epigraph: 'Épigraphe', front: 'Pages liminaires',
}

const it: Labels = {
  ...en,
  cover: 'Copertina', halftitle: 'Occhietto', title: 'Frontespizio', copyright: 'Colophon',
  navTitle: 'Indice', landmarks: 'Punti di riferimento', pageList: 'Elenco delle pagine',
  startReading: 'Inizia a leggere', page: 'pagina', eisbn: 'ISBN digitale', logoAlt: "Logo dell'editore",
  coverAlt: ({ title, authors, publisher }) => `Titolo: ${title}.` + (authors ? ` Autore: ${authors}.` : '') + (publisher ? ` Logo dell'editore: ${publisher}` : ''),
  a11ySummary: 'Questa pubblicazione è conforme alle WCAG 2.0 livello AA.',
  dedication: 'Dedica', epigraph: 'Epigrafe', front: 'Pagine iniziali',
}

const pt: Labels = {
  ...es,
  cover: 'Capa', halftitle: 'Anterrosto', title: 'Folha de rosto', copyright: 'Ficha técnica',
  navTitle: 'Índice', landmarks: 'Pontos de referência', pageList: 'Lista de páginas',
  startReading: 'Começar a ler', page: 'página', eisbn: 'ISBN digital', logoAlt: 'Logótipo da editora',
  coverAlt: ({ title, authors, publisher }) => `Título: ${title}.` + (authors ? ` Autor: ${authors}.` : '') + (publisher ? ` Logótipo da editora: ${publisher}` : ''),
  a11ySummary: 'Esta publicação está em conformidade com as WCAG 2.0 nível AA.',
  dedication: 'Dedicatória', epigraph: 'Epígrafe', front: 'Pré-textuais',
}

const TABLE: Record<string, Labels> = { es, en, de, fr, it, pt, ca: es }

export const labelsFor = (lang: string): Labels => TABLE[lang.slice(0, 2).toLowerCase()] ?? en

// Section types recognised from heading text (all supported languages at once).
export type SectionType =
  | 'halftitle' | 'title' | 'copyright' | 'dedication' | 'epigraph' | 'toc' | 'list' | 'introduction' | 'preface'
  | 'foreword' | 'prologue' | 'part' | 'chapter' | 'conclusion' | 'epilogue' | 'afterword' | 'glossary'
  | 'appendix' | 'bibliography' | 'notes' | 'index' | 'about' | 'contributors' | 'acknowledgments' | 'other'

const KEYWORDS: [SectionType, RegExp][] = [
  ['dedication', /^(dedicatoria|dedication|widmung|d[ée]dicace|dedica|dedicat[oò]ria)\b/i],
  ['index', /^(index|[íi]ndice (anal[íi]tico|onom[áa]stico|tem[áa]tico|alfab[ée]tico|remissivo)|register|stichwortverzeichnis)\b/i],
  ['toc', /^([íi]ndice( general| de contenidos?)?|contents|table of contents|sumario|sum[áa]rio|inhalt(sverzeichnis)?|table des mati[èe]res|sommaire|contenidos?|sommario)$/i],
  ['list', /^(lista de|list of|liste des|verzeichnis der|elenco de)/i],
  ['introduction', /^(introducci[óo]n|introduction|einleitung|einf[üu]hrung|introduzione|introdu[çc][ãa]o)\b/i],
  ['preface', /^(prefacio|preface|vorwort|pr[ée]face|prefazione|pref[áa]cio)\b/i],
  ['foreword', /^(foreword|pre[áa]mbulo)\b/i],
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
  ['chapter', /^(cap[íi]tulo|chapter|kapitel|chapitre|capitolo|cap[íi]tol)\b/i],
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

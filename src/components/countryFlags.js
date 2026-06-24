// ITF/ATP 3-letter country codes -> ISO 3166-1 alpha-2, used to build a
// flag image URL (flag emoji render unreliably across OS/browser
// combinations — e.g. plain "IT"/"ES" instead of an actual flag on some
// Windows setups — so we use real flag images instead).
const ALPHA2 = {
  ALG: 'dz', ARG: 'ar', ARM: 'am', AUS: 'au', AUT: 'at',
  AZE: 'az', BAR: 'bb', BEL: 'be', BIH: 'ba', BLR: 'by',
  BOL: 'bo', BRA: 'br', BUL: 'bg', CAN: 'ca', CHI: 'cl',
  CHN: 'cn', COL: 'co', CRC: 'cr', CRO: 'hr', CYP: 'cy',
  CZE: 'cz', DEN: 'dk', DOM: 'do', ECU: 'ec', EGY: 'eg',
  ESP: 'es', EST: 'ee', FIN: 'fi', FRA: 'fr', GBR: 'gb',
  GEO: 'ge', GER: 'de', GRE: 'gr', GUA: 'gt', HKG: 'hk',
  HUN: 'hu', INA: 'id', IND: 'in', IRL: 'ie', ISL: 'is',
  ISR: 'il', ITA: 'it', JPN: 'jp', KAZ: 'kz', KOR: 'kr',
  KUW: 'kw', LAT: 'lv', LIB: 'lb', LTU: 'lt', LUX: 'lu',
  MAR: 'ma', MDA: 'md', MEX: 'mx', MKD: 'mk', MNE: 'me',
  MON: 'mc', NED: 'nl', NGR: 'ng', NOR: 'no', NZL: 'nz',
  PAR: 'py', PER: 'pe', PHI: 'ph', POL: 'pl', POR: 'pt',
  PUR: 'pr', QAT: 'qa', ROU: 'ro', RSA: 'za', RUS: 'ru',
  SGP: 'sg', SLO: 'si', SRB: 'rs', SUI: 'ch', SVK: 'sk',
  SWE: 'se', THA: 'th', TPE: 'tw', TUN: 'tn', TUR: 'tr',
  UAE: 'ae', UKR: 'ua', URU: 'uy', USA: 'us', UZB: 'uz',
  VEN: 've', VIE: 'vn',
};

// flagcdn.com serves small flat PNG flags by ISO alpha-2 code — no API key,
// no rate limit for this use case.
export function countryFlagUrl(code) {
  if (!code) return null;
  const alpha2 = ALPHA2[code.toUpperCase()];
  if (!alpha2) return null;
  return `https://flagcdn.com/24x18/${alpha2}.png`;
}

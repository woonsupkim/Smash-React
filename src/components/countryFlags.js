// ITF/ATP 3-letter country codes -> ISO 3166-1 alpha-2, used to build a
// flag image URL (flag emoji render unreliably across OS/browser
// combinations — e.g. plain "IT"/"ES" instead of an actual flag on some
// Windows setups — so we use real flag images instead).
const ALPHA2 = {
  ARG: 'ar', AUS: 'au', AUT: 'at', BEL: 'be', BRA: 'br',
  BUL: 'bg', CAN: 'ca', CHI: 'cl', CHN: 'cn', COL: 'co',
  CRO: 'hr', CZE: 'cz', DEN: 'dk', ECU: 'ec', EGY: 'eg',
  ESP: 'es', FIN: 'fi', FRA: 'fr', GBR: 'gb', GEO: 'ge',
  GER: 'de', GRE: 'gr', IND: 'in', ITA: 'it', JPN: 'jp',
  KAZ: 'kz', KOR: 'kr', MEX: 'mx', MON: 'mc', NED: 'nl',
  NOR: 'no', PER: 'pe', POL: 'pl', POR: 'pt', RSA: 'za',
  RUS: 'ru', SRB: 'rs', SUI: 'ch', SWE: 'se', TPE: 'tw',
  TUN: 'tn', UKR: 'ua', URU: 'uy', USA: 'us',
};

// flagcdn.com serves small flat PNG flags by ISO alpha-2 code — no API key,
// no rate limit for this use case.
export function countryFlagUrl(code) {
  if (!code) return null;
  const alpha2 = ALPHA2[code.toUpperCase()];
  if (!alpha2) return null;
  return `https://flagcdn.com/24x18/${alpha2}.png`;
}

// ITF/ATP 3-letter country codes -> flag emoji. Covers codes currently
// present in the roster CSVs, plus a handful of other common tennis
// nationalities likely to show up as the roster grows.
const FLAGS = {
  ARG: '🇦🇷', AUS: '🇦🇺', AUT: '🇦🇹', BEL: '🇧🇪', BRA: '🇧🇷',
  BUL: '🇧🇬', CAN: '🇨🇦', CHI: '🇨🇱', CHN: '🇨🇳', COL: '🇨🇴',
  CRO: '🇭🇷', CZE: '🇨🇿', DEN: '🇩🇰', ECU: '🇪🇨', EGY: '🇪🇬',
  ESP: '🇪🇸', FIN: '🇫🇮', FRA: '🇫🇷', GBR: '🇬🇧', GEO: '🇬🇪',
  GER: '🇩🇪', GRE: '🇬🇷', IND: '🇮🇳', ITA: '🇮🇹', JPN: '🇯🇵',
  KAZ: '🇰🇿', KOR: '🇰🇷', MEX: '🇲🇽', MON: '🇲🇨', NED: '🇳🇱',
  NOR: '🇳🇴', PER: '🇵🇪', POL: '🇵🇱', POR: '🇵🇹', RSA: '🇿🇦',
  RUS: '🇷🇺', SRB: '🇷🇸', SUI: '🇨🇭', SWE: '🇸🇪', TPE: '🇹🇼',
  TUN: '🇹🇳', UKR: '🇺🇦', URU: '🇺🇾', USA: '🇺🇸',
};

export function countryFlag(code) {
  if (!code) return '';
  return FLAGS[code.toUpperCase()] || '';
}

import { describe, it, expect } from 'vitest';
import { lastName } from './names';
import { cleanEventName } from './eventName';

describe('lastName', () => {
  it('keeps simple surnames', () => {
    expect(lastName('Jannik Sinner')).toBe('Sinner');
    expect(lastName('Aryna Sabalenka')).toBe('Sabalenka');
  });
  it('keeps surname particles', () => {
    expect(lastName('Alex de Minaur')).toBe('de Minaur');
    expect(lastName('Luca Van Assche')).toBe('Van Assche');
    expect(lastName('Botic van de Zandschulp')).toBe('van de Zandschulp');
  });
  it('keeps hyphenated surnames intact', () => {
    expect(lastName('Felix Auger-Aliassime')).toBe('Auger-Aliassime');
  });
  it('never eats the whole name', () => {
    expect(lastName('Sinner')).toBe('Sinner');
    expect(lastName('')).toBe('');
    expect(lastName(null)).toBe('');
  });
});

describe('cleanEventName', () => {
  it('strips the city suffix', () => {
    expect(cleanEventName('Wimbledon - London')).toBe('Wimbledon');
    expect(cleanEventName('French Open - Paris')).toBe('French Open');
  });
  it('handles hyphenated cities', () => {
    expect(cleanEventName('Monte-Carlo Rolex Masters - Monte-Carlo')).toBe('Monte-Carlo Rolex Masters');
    expect(cleanEventName("Libema Open - 's-Hertogenbosch")).toBe('Libema Open');
  });
  it('merges the leading-The variant', () => {
    expect(cleanEventName('The HSBC Championships - London')).toBe('HSBC Championships');
    expect(cleanEventName('HSBC Championships - London')).toBe('HSBC Championships');
  });
  it('leaves clean names alone', () => {
    expect(cleanEventName('Wimbledon')).toBe('Wimbledon');
    expect(cleanEventName(null)).toBe(null);
  });
});

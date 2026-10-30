/** The control codes printed on the table (GLOSSARY: control code), in the order they appear, with the Slovak label the worker reads. */
export const CONTROL_CODES: readonly { code: string; label: string; hint: string }[] = [
  { code: 'C-VYCH', label: 'Vychystanie', hint: 'Začínam vychystávať' },
  { code: 'C-BAL', label: 'Balenie', hint: 'Začínam baliť' },
  { code: 'C-KONIEC', label: 'Koniec DL', hint: 'Dodací list je hotový' },
  { code: 'C-PAUZA', label: 'Pauza', hint: 'Obed alebo iná práca – čas sa nepočíta' },
  { code: 'C-POKRAC', label: 'Pokračovať', hint: 'Vraciam sa po pauze' },
  { code: 'C-ODHLAS', label: 'Odhlásiť', hint: 'Končím na tejto stanici' },
];

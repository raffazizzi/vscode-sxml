export const ERR_VALID = 'ERR_VALID';
export const ERR_SCH = 'ERR_SCH';
export const ERR_WELLFORM = 'ERR_WELLFORM';
export const ERR_SCHEMA = 'ERR_SCHEMA';
export const NO_ERR = 'NO_ERR';
export const XINCLUDE_NS = 'http://www.w3.org/2001/XInclude';
export const XINCLUDE_LOCAL = 'include';

export enum CompletionRequest {
  TAG = 'TAG',
  ATT = 'ATT',
  VAL = 'VAL'
}

// XML Name regex (minus : and [#x10000-#xEFFFF] range)
const nameStartChar = new RegExp(/_|[A-Z]|[a-z]|[\u00C0-\u00D6]|[\u00D8-\u00F6]|[\u00F8-\u02FF]|[\u0370-\u037D]|[\u037F-\u1FFF]|[\u200C-\u200D]|[\u2070-\u218F]|[\u2C00-\u2FEF]|[\u3001-\uD7FF]|[\uF900-\uFDCF]|[\uFDF0-\uFFFD]/);
const nameChar = new RegExp(`${nameStartChar.source}|-|\\.|[0-9]|\u00B7|[\u0300-\u036F]|[\u203F-\u2040]`);
export const XMLname = new RegExp(`^(${nameStartChar.source})(${nameChar.source})*$`);

/** Old built-in template prefixes are presentation aliases; saved graph IDs stay stable. */
export function productLabel(value:string):string {
  return value.replace(/^(?:融光(?:创作设计)?|AI Fusion Video|Inspire[- ]Studio|Loomic)(?=\s*[·—:：-]|$)/i,"Helstera");
}

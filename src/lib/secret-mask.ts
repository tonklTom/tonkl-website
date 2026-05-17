const HIDDEN_SECRET = "[hidden secret]";
const HIDDEN_PHRASE = "[hidden recovery phrase]";
const HIDDEN_KEY = "[hidden private key]";
const HIDDEN_PASSPHRASE = "[hidden passphrase]";

const SECRET_JSON_KEYS =
  /"((?:spending_sk|private_key|secret_key|scan_sk|mnemonic|seed_phrase|recovery_phrase|passphrase|password))"\s*:\s*"[^"]*"/gi;

const SECRET_ENV_KEYS =
  /\b((?:TONKL_)?(?:PRIVATE_KEY|SECRET_KEY|SPENDING_SK|SCAN_SK|MNEMONIC|SEED_PHRASE|RECOVERY_PHRASE|PASSPHRASE|PASSWORD))\s*=\s*([^\s,;]+)/gi;

const SECRET_KEY_ASSIGNMENTS =
  /\b((?:private|spending|secret|scan)\s*(?:key|sk)|private_key|secret_key|spending_sk|scan_sk|sk)\b\s*(?:is|:|=)?\s*((?:0x)?[0-9a-fA-F]{32,128})\b/gi;

const PHRASE_ASSIGNMENTS =
  /\b(seed\s*phrase|recovery\s*phrase|mnemonic(?:\s*phrase)?|secret\s*phrase)\b\s*(?:is|:|=)?\s+([a-zA-Z]+(?:[\s,]+[a-zA-Z]+){11,23})/gi;

const PASSPHRASE_ASSIGNMENTS =
  /\b((?:wallet|database|db|bip39)?\s*(?:passphrase|password|pin))\b\s*(?:is|:|=)\s*("[^"]+"|'[^']+'|[^\n,;]{3,})/gi;

export type SecretMaskResult = {
  text: string;
  masked: boolean;
};

export function maskSecretText(input: string): SecretMaskResult {
  if (!input) return { text: input, masked: false };

  if (looksLikeBareMnemonic(input)) {
    return { text: HIDDEN_PHRASE, masked: true };
  }

  let masked = false;
  let text = input;

  text = text.replace(SECRET_JSON_KEYS, (_match, key: string) => {
    masked = true;
    return `"${key}":"${HIDDEN_SECRET}"`;
  });

  text = text.replace(SECRET_ENV_KEYS, (_match, key: string) => {
    masked = true;
    return `${key}=${HIDDEN_SECRET}`;
  });

  text = text.replace(SECRET_KEY_ASSIGNMENTS, (_match, label: string) => {
    masked = true;
    return `${label.trim()} ${HIDDEN_KEY}`;
  });

  text = text.replace(PHRASE_ASSIGNMENTS, (_match, label: string) => {
    masked = true;
    return `${label.trim()} ${HIDDEN_PHRASE}`;
  });

  text = text.replace(PASSPHRASE_ASSIGNMENTS, (_match, label: string) => {
    masked = true;
    return `${label.trim()} ${HIDDEN_PASSPHRASE}`;
  });

  return { text, masked };
}

function looksLikeBareMnemonic(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length < 40 || trimmed.length > 300) return false;
  if (!/^[a-z]+(?:\s+[a-z]+)*$/.test(trimmed)) return false;

  const words = trimmed.split(/\s+/);
  if (![12, 15, 18, 21, 24].includes(words.length)) return false;

  return words.every((word) => word.length >= 3 && word.length <= 12);
}

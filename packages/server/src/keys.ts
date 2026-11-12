const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

const random = (length: number) => {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("")
}

/** A public Environment key that carries the Environment name: `pk_<name>_<random>`. */
export const makeEnvironmentKey = (environmentName: string) => `pk_${environmentName}_${random(24)}`

export const makeId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`

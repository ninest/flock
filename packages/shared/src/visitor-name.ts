// The Visitor name: a made-up two-word name, such as "Quiet Heron", that an anonymous persistent
// Visitor is shown by. Decided purely from the Visitor ID, never stored, so every page (and any later
// server use) agrees. Collisions are fine: the Visitor profile shows the Visitor ID as well.

const ADJECTIVES = [
  "Amber", "Ancient", "Bold", "Brave", "Bright", "Brisk", "Calm", "Clever", "Cosmic", "Crimson",
  "Curious", "Dapper", "Dusty", "Eager", "Early", "Fancy", "Fierce", "Gentle", "Gilded", "Golden",
  "Hidden", "Humble", "Icy", "Jolly", "Keen", "Kind", "Lively", "Lucky", "Lunar", "Mellow",
  "Merry", "Misty", "Modest", "Nimble", "Noble", "Odd", "Patient", "Plucky", "Polite", "Proud",
  "Quick", "Quiet", "Rapid", "Restless", "Rosy", "Rustic", "Sandy", "Shy", "Silent", "Silver",
  "Sleepy", "Sly", "Snowy", "Solar", "Steady", "Stormy", "Sunny", "Swift", "Tidy", "Velvet",
  "Wandering", "Wild", "Witty", "Zesty"
] as const

const ANIMALS = [
  "Alpaca", "Badger", "Beaver", "Bison", "Bobcat", "Camel", "Cheetah", "Condor", "Coyote", "Crane",
  "Dingo", "Dolphin", "Eagle", "Falcon", "Ferret", "Finch", "Fox", "Gazelle", "Gecko", "Heron",
  "Hedgehog", "Ibis", "Jackal", "Jaguar", "Koala", "Lemur", "Leopard", "Lynx", "Magpie", "Marmot",
  "Meerkat", "Mole", "Moose", "Narwhal", "Newt", "Ocelot", "Octopus", "Otter", "Owl", "Panda",
  "Panther", "Parrot", "Pelican", "Penguin", "Puffin", "Quail", "Rabbit", "Raccoon", "Raven", "Robin",
  "Salmon", "Seal", "Sparrow", "Stoat", "Swan", "Tapir", "Tiger", "Toucan", "Turtle", "Walrus",
  "Weasel", "Whale", "Wombat", "Yak"
] as const

/** FNV-1a over the ID's UTF-16 code units, then Murmur3's finaliser so every bit depends on every input bit: 32 bits. */
const hash = (text: string) => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** An anonymous Visitor's Visitor name, such as "Quiet Heron": an adjective and an animal picked by hashing the Visitor ID. */
export const visitorName = (visitorId: string): string => {
  const h = hash(visitorId)
  // Separate bits of the hash pick each word, so the animal isn't tied to the adjective.
  const adjective = ADJECTIVES[h % ADJECTIVES.length]!
  const animal = ANIMALS[Math.floor(h / ADJECTIVES.length) % ANIMALS.length]!
  return `${adjective} ${animal}`
}

/** How a Visitor is shown: by their Display name, else by their ID when identified, else by their Visitor name. */
export const visitorLabel = (
  visitor: { readonly visitorId: string; readonly identified: boolean; readonly displayName?: string | null }
): string => visitor.displayName ?? (visitor.identified ? visitor.visitorId : visitorName(visitor.visitorId))

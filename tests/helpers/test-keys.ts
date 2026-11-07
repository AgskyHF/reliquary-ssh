/**
 * Key generation for the test helpers.
 *
 * ssh2 1.17 produces a malformed OpenSSH private key for ed25519 roughly
 * once in 300 runs — the keychain service regenerates on a parse failure
 * (see app/services/keychain.ts), and the test helpers need the same
 * guard. Without it the suite fails at random.
 */
import { utils } from 'ssh2'

/**
 * Generates an ed25519 key pair whose private part actually parses.
 *
 * @param attempts How many times to try before giving up.
 */
export function generateUsableKeyPair(attempts = 5): { private: string; public: string } {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < attempts; attempt++) {
    const pair = utils.generateKeyPairSync('ed25519')
    const parsed = utils.parseKey(pair.private)
    if (!(parsed instanceof Error)) return pair
    lastError = parsed
  }

  throw new Error(
    `Could not generate a usable key pair after ${attempts} attempts: ${lastError?.message ?? 'unknown error'}`
  )
}

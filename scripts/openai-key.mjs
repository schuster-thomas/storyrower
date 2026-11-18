// Reads the OpenAI API key from the environment variable `gpt_api_key` (see env-key.mjs).
import { envKey } from './env-key.mjs';

export const openAiKey = () => envKey('gpt_api_key');

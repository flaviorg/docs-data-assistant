// Registro dos prompts v1. A guarda de saída e o teste de contrato das fixtures percorrem esta lista.
import type { PromptDef } from '../prompt.ts';
import { ragAnswerPrompt } from './rag-answer.ts';
import { routerPrompt } from './router.ts';
import { safeguardPrompt } from './safeguard.ts';
import { sqlAnswerPrompt } from './sql-answer.ts';
import { sqlCorrectPrompt } from './sql-correct.ts';
import { sqlGeneratePrompt } from './sql-generate.ts';

// `any`: a lista mistura prompts com tipos de entrada e saída diferentes.
export const PROMPTS_V1: PromptDef<any, any>[] = [routerPrompt, ragAnswerPrompt, sqlGeneratePrompt, sqlCorrectPrompt, sqlAnswerPrompt, safeguardPrompt];

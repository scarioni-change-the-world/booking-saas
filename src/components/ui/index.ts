/**
 * The application's own component vocabulary.
 *
 * Screens import from here rather than assembling divs and remembered class
 * names, so a spacing or colour decision changes in one file instead of
 * twelve. Adoption is incremental on purpose: each of these renders the
 * same classes the hand-written markup already used, so a converted screen
 * and an unconverted one look identical until the converted one is improved.
 */
export { PrimaryButton, SecondaryButton, DestructiveAction, TextLink } from './Button';
export { PageHeader, SectionHeader, Surface } from './Layout';
export { DataRow, InitialsMark, AnswerPair } from './DataRow';
export { FormField, ChoiceCard } from './Form';
export { StatusLabel, StatBlock, EmptyState, type StatusTone } from './StatusLabel';

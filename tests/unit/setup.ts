import 'fake-indexeddb/auto';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';

// fake-indexeddb copie les valeurs avec le structuredClone de Node, qui ne connaît pas les
// Blob/File de jsdom (ils deviendraient des objets vides). Les navigateurs réels n'ont pas
// ce problème ; dans les tests, on utilise donc les Blob/File natifs de Node.
globalThis.Blob = NodeBlob as unknown as typeof Blob;
globalThis.File = NodeFile as unknown as typeof File;

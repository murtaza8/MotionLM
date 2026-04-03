/// <reference types="vite/client" />

// Vite ?raw imports — used for loading sample composition source files as strings
declare module "*.tsx?raw" {
  const content: string;
  export default content;
}

declare module "*.ts?raw" {
  const content: string;
  export default content;
}

declare namespace NodeJS {
  interface ProcessEnv {
    PORT: string;
    POSTGRES_PORT: string;
    POSTGRES_HOST: string;
    POSTGRES_USER: string;
    POSTGRES_PASSWORD: string;
  }
}

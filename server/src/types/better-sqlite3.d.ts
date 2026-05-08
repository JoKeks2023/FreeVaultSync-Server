declare module 'better-sqlite3' {
  type Options = any;
  class Database {
    constructor(filename: string, options?: Options);
    pragma(command: string): any;
    prepare(sql: string): any;
    exec(sql: string): any;
  }
  const _default: typeof Database;
  export default _default;
}

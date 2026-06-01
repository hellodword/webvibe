export class Mutex {
  private current = Promise.resolve();

  async runExclusive<T>(callback: () => Promise<T>): Promise<T> {
    const prior = this.current;
    let release!: () => void;
    this.current = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      return await callback();
    } finally {
      release();
    }
  }
}

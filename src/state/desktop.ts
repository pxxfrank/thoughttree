import { TauriPersistence } from '../storage/tauri-persistence'
import { AppStore } from './store'

export async function createDesktopStore(): Promise<AppStore> {
  const persistence = new TauriPersistence()
  await persistence.init()
  return new AppStore(persistence)
}

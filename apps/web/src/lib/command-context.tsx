import { createContext, useContext, type ReactNode } from 'react'
import { CommandError, type CommandInput } from './ws'

export type CommandSender = (input: CommandInput) => Promise<unknown>

export const offlineCommand: CommandSender = () =>
  Promise.reject(new CommandError('ws_offline', 'WebSocket 未连接'))

const CommandContext = createContext<CommandSender>(offlineCommand)

export function CommandProvider({ send, children }: { send: CommandSender; children: ReactNode }) {
  return <CommandContext.Provider value={send}>{children}</CommandContext.Provider>
}

export function useCommand() {
  return useContext(CommandContext)
}

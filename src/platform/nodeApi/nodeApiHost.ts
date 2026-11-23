import { defineStore } from 'pinia'

import type { ImportedWorkflow, VersionHost } from './shared/versionHost'
import { useComfyApiStore } from './v4/comfyApiStore'

/** The host's one door into the node API: each call reaches every published version, oldest first. */
export const useNodeApiHost = defineStore('nodeApiHost', () =>
  createNodeApiHost([useComfyApiStore()])
)

type Notice = {
  [K in keyof VersionHost]: VersionHost[K] extends (...args: never[]) => void
    ? K
    : never
}[keyof VersionHost]

/** Fans each host call out to `versions`, in order; the first version that imports a file keeps it. */
export function createNodeApiHost(versions: readonly VersionHost[]) {
  const toEach =
    <K extends Notice>(call: K) =>
    (...args: Parameters<VersionHost[K]>) => {
      for (const version of versions)
        Reflect.apply(version[call], version, args)
    }

  return {
    provideCanvas: toEach('provideCanvas'),
    publish: toEach('publish'),
    markReady: toEach('markReady'),
    providePacks: toEach('providePacks'),
    endDocument: toEach('endDocument'),
    beginDocument: toEach('beginDocument'),
    beforeHistoryRestore: toEach('beforeHistoryRestore'),
    afterHistoryRestore: toEach('afterHistoryRestore'),
    workflowLoaded: toEach('workflowLoaded'),
    reapplyTypeColors: toEach('reapplyTypeColors'),
    deliverPreview: toEach('deliverPreview'),
    queue: {
      promptSubmitted: (
        ...submitted: Parameters<VersionHost['queue']['promptSubmitted']>
      ) => {
        for (const { queue } of versions) queue.promptSubmitted(...submitted)
      },
      promptRejected: () => {
        for (const { queue } of versions) queue.promptRejected()
      },
      queueSettled: () => {
        for (const { queue } of versions) queue.queueSettled()
      }
    },
    async importWorkflowFile<TFound extends object | undefined>(
      file: File,
      found: TFound
    ): Promise<TFound | ImportedWorkflow> {
      let read: TFound | ImportedWorkflow = found
      for (const version of versions) {
        read = await version.importWorkflowFile(file, read)
      }
      return read
    },
    frontendExecution: {
      adoptNodes: (nodes) => {
        for (const { frontendExecution } of versions)
          frontendExecution.adoptNodes(nodes)
      },
      omittedInputs: (node) =>
        versions.flatMap(({ frontendExecution }) =>
          frontendExecution.omittedInputs(node)
        )
    }
  } satisfies VersionHost
}

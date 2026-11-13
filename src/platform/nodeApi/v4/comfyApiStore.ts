import { once } from 'es-toolkit'
import { defineStore } from 'pinia'

import { useWorkflowStore } from '@/platform/workflow/management/stores/workflowStore'
import { useExtensionService } from '@/platform/extensions/services/extensionService'

import { api } from '@/scripts/api'
import { useApp } from '@/scripts/appInstance'
import { ChangeTracker } from '@/scripts/changeTracker'
import { isChangeCaptureSuppressed } from '@/services/changeCaptureSuppression'

import type { CanvasSource } from './canvasSource'
import { createComfyApi } from './comfyApi'

/** The app's one V4 node API, and the host's side of it. */
export const useComfyApiStore = defineStore('comfyApiV4', () => {
  let canvas: CanvasSource | undefined
  const { comfy, host } = createComfyApi({
    canvas: () => canvas,
    getGraph: () => useApp().canvasOrUndefined?.graph ?? null,
    history: () => useWorkflowStore().activeWorkflow?.changeTracker,
    isLoading: () =>
      ChangeTracker.isLoadingGraph || isChangeCaptureSuppressed(),
    extensionsUrl: () =>
      new URL(api.fileURL('/extensions/'), window.location.href).href
  })

  const installNodeTypeHooks = once(() =>
    useExtensionService().registerExtension(host.nodeTypeHooks)
  )

  function provideCanvas(source: CanvasSource): void {
    canvas = source
  }

  function publish(): void {
    Object.defineProperty(window, 'comfy_v4', {
      value: comfy,
      enumerable: true,
      configurable: true
    })
    installNodeTypeHooks()
  }

  return {
    publish,
    provideCanvas,
    workflowLoaded: host.workflowLoaded,
    importWorkflowFile: host.importWorkflowFile,
    queue: host.queue,
    reapplyTypeColors: host.reapplyTypeColors,
    markReady: host.markReady,
    providePacks: host.providePacks,
    endDocument: host.endDocument,
    beginDocument: host.beginDocument,
    beforeHistoryRestore: host.beforeHistoryRestore,
    afterHistoryRestore: host.afterHistoryRestore
  }
})

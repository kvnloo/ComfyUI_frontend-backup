import type { ComputedRef } from 'vue'

import type { LGraph } from '@/lib/litegraph/src/LGraph'
import type { ActionBarButton, TopbarBadge } from '@/types/comfy'

import type { CanvasSource } from '@/platform/nodeApi/shared/canvasSource'
import { createDocumentHandles } from '@/platform/nodeApi/shared/documentHandles'
import type { GraphResolver } from '@/platform/nodeApi/shared/documentHandles'
import type { VersionHost } from '@/platform/nodeApi/shared/versionHost'

import { API_VERSION, isApiVersionAtLeast } from './apiVersion'
import { createAppLifecycle } from './appLifecycle'
import { createEditRunner } from './edit/editRunner'
import type { EditHistory } from './edit/editRunner'
import { createEdits } from './edit/edits'
import type { EditCore } from './edit/edits'
import { graphHandleMembers } from './edit/graphHandleMembers'
import { groupHandleMembers } from './edit/groupHandleMembers'
import { createGroupHandles } from './edit/groupHandles'
import { nodeHandleMembers } from './edit/nodeHandleMembers'
import { createSlotHandles } from './edit/slotHandles'
import { createDocuments } from './events/documents/documents'
import { createWorkflowExtra } from './events/documents/workflowExtra'
import { createWorkflowHandle } from './events/documents/workflowHandle'
import { createWorkflowImporters } from './events/documents/workflowImporters'
import { createExecutingNode } from './events/executingNode'
import { createQueue } from './events/queue/queueHandle'
import { isInteracting } from './events/interaction'
import { createNodeChanges } from './events/nodeChanges'
import { createNodeMoves } from './events/nodeMoves'
import { createSelectionEvents, selectedGroups } from './events/selection'
import { createViewportEvents } from './events/viewport'
import { centerOnArea, createGraphView } from './events/view/graphView'
import { nodeViewMembers } from './events/view/nodeView'
import { createDefRegistry } from './defs/defRegistry'
import type { NodeTypeHooks } from './defs/defRegistry'
import { createFrontendExecution } from './execution/frontendExecution'
import { createGraphHandle } from './graphHandle'
import { createGraphScopes } from './graphScopeHandle'
import { createNodeHandles } from './nodeHandle'
import { createPacks } from './packs'
import type { Comfy } from './types'
import { createBackendHandle } from './utilities/backendHandle'
import { createCommandsHandle } from './utilities/commandsHandle'
import { createLocalizationHandle } from './utilities/localizationHandle'
import { createModelsHandle } from './utilities/modelsHandle'
import { createSettingsHandle } from './utilities/settingsHandle'
import { createStorageHandle } from './utilities/storageHandle'
import { createSystemHandle } from './utilities/systemHandle'
import { createUi } from './utilities/ui/uiHandle'
import { createWidgetCollections } from './widgets/widgetCollection'

/** What the host supplies. */
export interface ComfyApiServices {
  /** The graph on screen: the root graph, or the subgraph the user is in. */
  getGraph(): LGraph | null
  /** The open document's undo history; without it an edit is no undo step. */
  history?(): EditHistory | undefined
  /** The canvas, once the renderer has supplied it. */
  canvas?(): CanvasSource | undefined
  /** True while the host loads or restores a graph, when a widget's commit is part of the load. */
  isLoading?(): boolean
  /** The URL extension folders are served under, base path included; `/extensions/` of the page by default. */
  extensionsUrl?(): string
}

/** What the host drives, each call as {@link VersionHost} describes it; the store publishes and gives the canvas. A pack never sees this. */
export interface ComfyApiHost extends Omit<
  VersionHost,
  'publish' | 'provideCanvas'
> {
  /** The top-bar badges packs have added, for the host to show. */
  readonly topbarBadges: ComputedRef<readonly TopbarBadge[]>
  /** The action-bar buttons packs have added, for the host to show. */
  readonly actionBarButtons: ComputedRef<readonly ActionBarButton[]>
  /** The extension through which the host tells the API about node types. */
  readonly nodeTypeHooks: NodeTypeHooks
}

/** The published API, the host's side of it, and the edit core every node, slot, link, group and graph edit runs through. */
export interface ComfyApi {
  comfy: Comfy
  host: ComfyApiHost
  /** Not published (ADR-EXTENSIONS-NODE-API-0073 decision 1); the core's own tests drive it. */
  edit: EditCore
}

export function createComfyApi(services: ComfyApiServices): ComfyApi {
  const lifecycle = createAppLifecycle()
  const handles = createDocumentHandles(() => services.isLoading?.() ?? false)
  const canvas = () => services.canvas?.()
  const chrome = createUi(canvas)
  const runner = createEditRunner(() => services.history?.())
  const widgets = createWidgetCollections(
    handles,
    runner,
    () => services.isLoading?.() ?? false
  )
  const nodes = createNodeHandles(handles, (handle) => ({
    ...nodeHandleMembers(handle, edit, nodes, slots),
    ...nodeViewMembers(handle, nodes, canvas),
    widgets: widgets.widgetsOf(() => nodes.locator(handle)?.())
  }))
  const slots = createSlotHandles(handles, nodes, () => edit)
  const groups = createGroupHandles(
    handles,
    nodes,
    (handle) => groupHandleMembers(handle, edit),
    (graph, area) => centerOnArea(canvas, graph, area)
  )
  const { groupsOf } = groups
  const scopes = createGraphScopes(handles, nodes, (resolveGraph) => ({
    groups: () => {
      const graph = resolveGraph()
      return graph && groupsOf(graph)
    },
    resolvedSupplies: () => suppliesIn(resolveGraph)
  }))
  const edit = createEdits(nodes, scopes, slots, groups, () =>
    services.history?.()
  )
  const packs = createPacks(
    () =>
      services.extensionsUrl?.() ??
      new URL('/extensions/', window.location.href).href
  )
  const definitions = createDefRegistry(nodes, widgets.widgetTypes, packs)
  const visibleGraph = () => canvas()?.visibleGraph() ?? null
  const moves = createNodeMoves(nodes, canvas)
  const executing = createExecutingNode(nodes, services.getGraph)
  const documents = createDocuments()
  const importers = createWorkflowImporters()
  const queue = createQueue(nodes)
  const execution = createFrontendExecution(
    definitions.resolvers,
    definitions.nodeHooks
  )
  const suppliesIn = (resolveGraph: GraphResolver) => {
    const graph = resolveGraph()
    return graph && execution.resolvedSupplies(graph)
  }

  const comfy = Object.freeze({
    getApiVersion: () => API_VERSION,
    isApiVersionAtLeast,
    registerPack: packs.registerPack,
    onReady: lifecycle.onReady,
    onNodeChanged: createNodeChanges(nodes, visibleGraph),
    onNodeMoved: moves.onNodeMoved,
    onNodeDragEnd: moves.onNodeDragEnd,
    isInteracting: () => isInteracting(canvas()),
    onViewportChanged: createViewportEvents(canvas),
    onSelectionChanged: createSelectionEvents(nodes, visibleGraph),
    executingNode: executing.executingNode,
    executionNode: executing.executionNode,
    onExecutingNodeChanged: executing.onExecutingNodeChanged,
    onWorkflowLoaded: documents.onWorkflowLoaded,
    onDocumentActivated: documents.onDocumentActivated,
    onDocumentClosed: documents.onDocumentClosed,
    workflow: createWorkflowHandle(
      documents.current,
      importers,
      services.getGraph,
      createWorkflowExtra(documents.changeTrackerOf, services.getGraph, runner)
    ),
    queue: queue.queue,
    defs: definitions.defs,

    graph: createGraphHandle(
      nodes,
      scopes.scopeFor,
      services.getGraph,
      handles.rebuilds,
      (visible) => ({
        ...graphHandleMembers(visible, scopes.scopeFor, edit, groupsOf),
        ...createGraphView(nodes, visible, canvas),
        groupSelection: () => selectedGroups(groupsOf, visible()),
        resolvedSupplies: () => suppliesIn(visible) ?? Object.freeze([])
      })
    ),
    settings: createSettingsHandle(),
    storage: createStorageHandle(),
    commands: createCommandsHandle(),
    backend: createBackendHandle(),
    models: createModelsHandle(),
    ui: chrome.ui,
    localization: createLocalizationHandle(),
    system: createSystemHandle(),
    sameEntity: (a: unknown, b: unknown) => a === b && handles.owns(a)
  } satisfies Comfy)

  return {
    comfy,
    edit,
    host: {
      topbarBadges: chrome.topbarBadges,
      actionBarButtons: chrome.actionBarButtons,
      nodeTypeHooks: definitions.nodeTypeHooks,
      reapplyTypeColors: definitions.reapplyTypeColors,
      frontendExecution: execution.prompt,
      deliverPreview: execution.deliverPreview,
      markReady: lifecycle.markReady,
      providePacks: packs.provide,
      workflowLoaded: documents.workflowLoaded,
      queue: queue.host,
      importWorkflowFile: importers.importUnreadFile,
      endDocument: handles.endDocument,
      beginDocument: handles.beginDocument,
      beforeHistoryRestore: handles.beforeHistoryRestore,
      afterHistoryRestore: handles.afterHistoryRestore
    }
  }
}

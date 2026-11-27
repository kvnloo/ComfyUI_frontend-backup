import * as THREE from 'three'

import { MeshModelAdapter } from '#/load3d/MeshModelAdapter'
import { fetchModelData } from '#/load3d/ModelAdapter'
import type { ModelLoadContext } from '#/load3d/ModelAdapter'
import type { Load3dHost } from '#/load3d/interfaces'

const MIN_FRAME_SIZE = 1e-6

export const SUBJECT_MODEL_SCENE_SCALE = 1 / Math.sqrt(3)

export interface SubjectModelSource {
  rootFolder: string
  subfolder: string
  filename: string
}

export interface SubjectModel {
  root: THREE.Group
  floorY: number
}

function forEachVertex(
  object: THREE.Object3D,
  visit: (vertex: THREE.Vector3) => void
): void {
  const local = new THREE.Vector3()
  const vertex = new THREE.Vector3()
  object.updateMatrixWorld(true)
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const positions = child.geometry.getAttribute('position')
    if (!positions) return
    const placements = instancePlacements(child)
    for (let index = 0; index < positions.count; index++) {
      child.getVertexPosition(index, local)
      if (!Number.isFinite(local.lengthSq())) continue
      for (const placement of placements) {
        visit(vertex.copy(local).applyMatrix4(placement))
      }
    }
  })
}

function instancePlacements(mesh: THREE.Mesh): THREE.Matrix4[] {
  if (!(mesh instanceof THREE.InstancedMesh)) return [mesh.matrixWorld]
  return Array.from({ length: mesh.count }, (_, instance) => {
    const placement = new THREE.Matrix4()
    mesh.getMatrixAt(instance, placement)
    return placement.premultiply(mesh.matrixWorld)
  })
}

export function placeInMeshFrame(object: THREE.Object3D): SubjectModel | null {
  const bounds = new THREE.Box3()
  forEachVertex(object, (vertex) => bounds.expandByPoint(vertex))
  if (bounds.isEmpty()) return null

  const center = bounds.getCenter(new THREE.Vector3())
  let radiusSquared = 0
  forEachVertex(object, (vertex) => {
    radiusSquared = Math.max(radiusSquared, vertex.distanceToSquared(center))
  })
  const size = Math.max(2 * Math.sqrt(radiusSquared), MIN_FRAME_SIZE)

  const root = new THREE.Group()
  root.name = 'CameraInfoSubjectModel'
  root.add(object)
  root.scale.setScalar(1 / size)
  root.position.copy(center).multiplyScalar(-1 / size)
  return { root, floorY: (bounds.min.y - center.y) / size }
}

function createLoadContext(): ModelLoadContext {
  return {
    setOriginalModel: () => {},
    registerOriginalMaterial: () => {},
    standardMaterial: new THREE.MeshStandardMaterial(),
    materialMode: 'original'
  }
}

export async function loadSubjectModel(
  host: Load3dHost,
  source: SubjectModelSource,
  signal?: AbortSignal
): Promise<THREE.Object3D | null> {
  const adapter = new MeshModelAdapter()
  const supported: readonly string[] = adapter.extensions
  const extension = source.filename.split('.').pop()?.toLowerCase()
  if (!extension || !supported.includes(extension)) return null

  const path =
    'api/view?type=' +
    source.rootFolder +
    '&subfolder=' +
    encodeURIComponent(source.subfolder) +
    '&filename='
  let bytes: Promise<ArrayBuffer> | null = null
  const fetchBytes = () =>
    (bytes ??= fetchModelData(host.fetchApi, path, source.filename, signal))

  try {
    const result = await adapter.load(
      createLoadContext(),
      path,
      source.filename,
      fetchBytes
    )
    return result?.object ?? null
  } catch {
    return null
  }
}

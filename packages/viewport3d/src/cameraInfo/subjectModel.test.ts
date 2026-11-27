import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import type { Load3dHost } from '#/load3d/interfaces'

import { loadSubjectModel, placeInMeshFrame } from './subjectModel'

const TRIANGLE_STL = `solid triangle
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 2 0 0
vertex 0 2 0
endloop
endfacet
endsolid triangle`

function hostServing(body: string, status = 200): Load3dHost {
  return {
    fetchApi: vi.fn(async () => new Response(body, { status })),
    getPLYEngine: () => 'threejs',
    resolveImageURL: (path) => path
  }
}

function boxMesh(size: THREE.Vector3Tuple, position: THREE.Vector3Tuple) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size))
  mesh.position.set(...position)
  return mesh
}

function worldBounds(object: THREE.Object3D): THREE.Box3 {
  object.updateMatrixWorld(true)
  return new THREE.Box3().setFromObject(object, true)
}

describe('placeInMeshFrame', () => {
  it('centres the bounding box on the origin', () => {
    const subject = placeInMeshFrame(boxMesh([2, 4, 6], [10, 20, 30]))

    const center = worldBounds(subject!.root).getCenter(new THREE.Vector3())
    expect(center.length()).toBeCloseTo(0)
  })

  it('scales the bounding sphere to a diameter of one', () => {
    const subject = placeInMeshFrame(boxMesh([2, 4, 6], [10, 20, 30]))

    const diagonal = worldBounds(subject!.root).getSize(new THREE.Vector3())
    expect(diagonal.length()).toBeCloseTo(1)
  })

  it('reports where the bottom of the model sits', () => {
    const subject = placeInMeshFrame(boxMesh([2, 4, 6], [10, 20, 30]))

    expect(subject!.floorY).toBeCloseTo(worldBounds(subject!.root).min.y)
    expect(subject!.floorY).toBeLessThan(0)
  })

  it('measures every mesh of a model together', () => {
    const model = new THREE.Group()
    model.add(boxMesh([1, 1, 1], [-4.5, 0, 0]), boxMesh([1, 1, 1], [4.5, 0, 0]))

    const subject = placeInMeshFrame(model)

    expect(
      worldBounds(subject!.root).getSize(new THREE.Vector3()).x
    ).toBeCloseTo(10 / Math.hypot(10, 1, 1))
  })

  it('measures every instance of an instanced mesh', () => {
    const instanced = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
      2
    )
    instanced.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-4.5, 0, 0))
    instanced.setMatrixAt(1, new THREE.Matrix4().makeTranslation(4.5, 0, 0))

    const subject = placeInMeshFrame(instanced)

    expect(subject!.root.scale.x).toBeCloseTo(1 / Math.hypot(10, 1, 1))
    expect(subject!.root.position.length()).toBeCloseTo(0)
  })

  it('ignores non-finite vertices', () => {
    const mesh = boxMesh([2, 2, 2], [0, 0, 0])
    mesh.geometry.getAttribute('position').setXYZ(0, Infinity, NaN, 0)

    const subject = placeInMeshFrame(mesh)

    expect(Number.isFinite(subject!.root.scale.x)).toBe(true)
    expect(Number.isFinite(subject!.floorY)).toBe(true)
  })

  it('returns null for a model without vertices', () => {
    expect(placeInMeshFrame(new THREE.Group())).toBeNull()
  })
})

describe('loadSubjectModel', () => {
  it('loads a mesh file from the folder it is stored in', async () => {
    const host = hostServing(TRIANGLE_STL)

    const object = await loadSubjectModel(host, {
      rootFolder: 'output',
      subfolder: '3d/in progress',
      filename: 'triangle.stl'
    })

    expect(host.fetchApi).toHaveBeenCalledWith(
      '/view?type=output&subfolder=3d%2Fin%20progress&filename=triangle.stl',
      expect.anything()
    )
    expect(placeInMeshFrame(object!)).not.toBeNull()
  })

  it.for(['scan.ply', 'scene.splat', 'no-extension'])(
    'resolves null for %s without fetching it',
    async (filename) => {
      const host = hostServing(TRIANGLE_STL)

      const object = await loadSubjectModel(host, {
        rootFolder: 'input',
        subfolder: '',
        filename
      })

      expect(object).toBeNull()
      expect(host.fetchApi).not.toHaveBeenCalled()
    }
  )

  it('resolves null when the file is missing', async () => {
    const object = await loadSubjectModel(hostServing('', 404), {
      rootFolder: 'input',
      subfolder: '',
      filename: 'missing.stl'
    })

    expect(object).toBeNull()
  })
})

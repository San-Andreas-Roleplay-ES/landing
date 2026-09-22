// Ensambla en Three.js un modelo ya preparado por modelData.ts (que corre en
// un Web Worker). Aquí solo queda lo que exige el hilo principal: crear
// geometrías, materiales y texturas; nada de parsear ni decodificar.
//
// Texturas: los TXD guardan la imagen de arriba abajo, igual que las UV de D3D
// (origen arriba-izquierda), así que NO se voltean. Además WebGL solo sabe
// voltear texturas sin comprimir: con flipY las RGBA salían al revés que las DXT.

import * as THREE from "three";

import type { PreparedModel, PreparedTexture } from "./modelData";

export interface BuildOptions {
  /** WebGL 2: mipmaps también para texturas que no son potencia de dos. */
  isWebGL2: boolean;
  /** Anisotropía máxima de la GPU (1 = sin filtrado anisótropo). */
  maxAnisotropy: number;
}

const isPowerOfTwo = (n: number) => (n & (n - 1)) === 0;

function buildTexture(tex: PreparedTexture, opts: BuildOptions): THREE.Texture {
  let texture: THREE.Texture;
  const top = tex.levels[0];

  if (tex.compressed) {
    const format =
      tex.compressed === "dxt1"
        ? tex.hasAlpha
          ? THREE.RGBA_S3TC_DXT1_Format
          : THREE.RGB_S3TC_DXT1_Format
        : tex.compressed === "dxt3"
          ? THREE.RGBA_S3TC_DXT3_Format
          : THREE.RGBA_S3TC_DXT5_Format;
    texture = new THREE.CompressedTexture(
      tex.levels as unknown as ImageData[],
      top.width,
      top.height,
      format,
      THREE.UnsignedByteType,
    );
    texture.generateMipmaps = false;
    // modelData solo deja más de un nivel cuando la cadena llega a 1×1.
    texture.minFilter =
      tex.levels.length > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  } else {
    texture = new THREE.DataTexture(
      top.data as Uint8Array<ArrayBuffer>,
      top.width,
      top.height,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    const mipmaps =
      opts.isWebGL2 || (isPowerOfTwo(top.width) && isPowerOfTwo(top.height));
    texture.generateMipmaps = mipmaps;
    texture.minFilter = mipmaps
      ? THREE.LinearMipmapLinearFilter
      : THREE.LinearFilter;
  }

  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.flipY = false;
  texture.encoding = THREE.sRGBEncoding;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.min(4, opts.maxAnisotropy);
  texture.needsUpdate = true;
  return texture;
}

export function buildModel(model: PreparedModel, opts: BuildOptions): THREE.Group {
  const textures = new Map<string, { texture: THREE.Texture; hasAlpha: boolean }>();
  for (const tex of model.textures)
    textures.set(tex.name, {
      texture: buildTexture(tex, opts),
      hasAlpha: tex.hasAlpha,
    });

  const group = new THREE.Group();
  for (const mesh of model.meshes) {
    const position = new THREE.BufferAttribute(mesh.positions, 3);
    const normal = mesh.normals ? new THREE.BufferAttribute(mesh.normals, 3) : null;
    const uv = mesh.uvs ? new THREE.BufferAttribute(mesh.uvs, 2) : null;

    for (const sub of mesh.subMeshes) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", position);
      if (normal) geometry.setAttribute("normal", normal);
      if (uv) geometry.setAttribute("uv", uv);
      geometry.setIndex(new THREE.BufferAttribute(sub.indices, 1));
      if (!normal) geometry.computeVertexNormals();

      // Lambert: los peds de SA son mates y es bastante más barato que el
      // material PBR en GPUs móviles.
      const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
      const built = sub.texture ? textures.get(sub.texture) : undefined;
      if (built) {
        material.map = built.texture;
        // Pelo, gafas, flecos: recorte por alfa (sin mezcla, que obligaría a
        // ordenar las mallas por profundidad).
        if (built.hasAlpha) material.alphaTest = 0.25;
        if (sub.color[3] < 1) {
          material.transparent = true;
          material.opacity = sub.color[3];
        }
      } else {
        material.color.setRGB(sub.color[0], sub.color[1], sub.color[2]);
      }
      const object = new THREE.Mesh(geometry, material);
      // El modelo siempre está encuadrado: sin descarte por frustum three no
      // calcula la esfera envolvente (todos los vértices, por cada submalla).
      object.frustumCulled = false;
      group.add(object);
    }
  }
  return group;
}

// Libera geometrías, materiales y texturas de un grupo construido.
export function disposeModel(group: THREE.Group): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const material = mesh.material as THREE.MeshLambertMaterial;
    material.map?.dispose();
    material.dispose();
  });
}

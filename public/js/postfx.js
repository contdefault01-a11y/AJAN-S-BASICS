// Fullscreen post-process for the final red hallucination: luminance-preserving red tint,
// gentle wave distortion, chromatic separation, pulsing vignette and brief interference bands.
// It is bypassed entirely (direct render) when the effect is off.
import * as THREE from 'three';

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.amount = 0;
    this.target = 0;
    this.flash = 0;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { magFilter: THREE.NearestFilter, minFilter: THREE.LinearFilter });
    this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: this.rt.texture }, time: { value: 0 }, amount: { value: 0 }, flash: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float time; uniform float amount; uniform float flash;
        varying vec2 vUv;
        float hash(float n){ return fract(sin(n)*43758.5453); }
        void main(){
          vec2 uv = vUv;
          float a = amount;
          uv.x += sin(uv.y*16.0 + time*2.1) * 0.0035 * a;
          uv.y += cos(uv.x*12.0 + time*1.6) * 0.0028 * a;
          float band = step(0.94, hash(floor(time*6.0))) * step(abs(uv.y - hash(floor(time*6.0)+3.0)), 0.04);
          uv.x += band * 0.02 * a;
          float ca = (0.0025 + 0.002*sin(time*3.0)) * a;
          vec3 col = vec3(texture2D(tDiffuse, uv + vec2(ca, 0.0)).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - vec2(ca, 0.0)).b);
          float lum = dot(col, vec3(0.3, 0.59, 0.11));
          vec3 red = vec3(0.12 + lum*1.35, lum*0.28, lum*0.22);
          col = mix(col, red, 0.62 * a);
          float vig = smoothstep(0.95, 0.35, length(vUv - 0.5)) ;
          col *= mix(1.0, vig * (0.85 + 0.15*sin(time*4.0)) + 0.25, 0.6 * a);
          col = mix(col, vec3(1.0, 0.1, 0.05), flash);
          gl_FragColor = vec4(col, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
  }

  setSize(w, h) { this.rt.setSize(Math.max(1, w), Math.max(1, h)); }

  render(scene, camera, dt, time) {
    this.amount += (this.target - this.amount) * Math.min(1, dt * 1.5);
    this.flash = Math.max(0, this.flash - dt * 2);
    if (this.amount < 0.01 && this.flash <= 0) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      return;
    }
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.mat.uniforms.time.value = time;
    this.mat.uniforms.amount.value = this.amount;
    this.mat.uniforms.flash.value = this.flash * 0.6;
    this.renderer.render(this.scene, this.cam);
  }
}

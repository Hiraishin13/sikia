import { describe, expect, it } from 'vitest'
import { Clock, deriveLabel, isImage, isVideo } from './mediaImport'

const f = (name: string, path = '', type = '') => ({ name, type, webkitRelativePath: path })

describe('déduction du signe', () => {
  it('texte fixe', () => expect(deriveLabel(f('x.jpg'), 'fixed', ' merci ')).toBe('merci'))

  it('nom du dossier parent (un dossier par signe)', () => {
    expect(deriveLabel(f('a.mp4', 'BONJOUR/a.mp4'), 'folder', '')).toBe('BONJOUR')
    expect(deriveLabel(f('a.mp4', 'jeu/MERCI/s1/a.mp4'), 'folder', '')).toBe('s1')
    expect(deriveLabel(f('a.mp4', ''), 'folder', '')).toBe('')
  })

  it('début du nom de fichier', () => {
    expect(deriveLabel(f('BONJOUR_03.mp4'), 'filename', '')).toBe('BONJOUR')
    expect(deriveLabel(f('merci-lent.webm'), 'filename', '')).toBe('merci')
    expect(deriveLabel(f('OUI12.jpg'), 'filename', '')).toBe('OUI')
    expect(deriveLabel(f('42.jpg'), 'filename', '')).toBe('42')
  })
})

describe('type de fichier', () => {
  it('reconnaît images et vidéos par le type ou par l\'extension', () => {
    expect(isImage(f('a.JPG'))).toBe(true)
    expect(isImage(f('a', '', 'image/png'))).toBe(true)
    expect(isVideo(f('a.mp4'))).toBe(true)
    expect(isVideo(f('a.txt'))).toBe(false)
    expect(isImage(f('a.mp4'))).toBe(false)
  })
})

describe('horloge du suivi', () => {
  it('est strictement croissante', () => {
    const c = new Clock()
    const t = [c.next(), c.next(), c.next()]
    expect(t[1]).toBeGreaterThan(t[0])
    expect(t[2]).toBeGreaterThan(t[1])
  })
})

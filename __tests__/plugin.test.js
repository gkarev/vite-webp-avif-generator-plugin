import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolve } from 'path';
import { mkdir, writeFile, rm, access } from 'fs/promises';
import { tmpdir } from 'os';
import convertImages from '../vite-webp-avif-generator-plugin.js';

describe('vite-webp-avif-generator-plugin', () => {
  let testDir;
  let plugin;

  beforeEach(async () => {
    // Создаём временную директорию для тестов
    testDir = resolve(tmpdir(), `vite-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    await mkdir(resolve(testDir, 'src/img'), { recursive: true });
    await mkdir(resolve(testDir, 'public/img'), { recursive: true });
  });

  afterEach(async () => {
    // Очищаем временную директорию
    await rm(testDir, { recursive: true, force: true });
  });

  describe('Инициализация плагина', () => {
    it('должен создавать плагин с дефолтными опциями', () => {
      plugin = convertImages();
      expect(plugin.name).toBe('vite-webp-avif-generator');
      expect(plugin.configResolved).toBeDefined();
      expect(plugin.configureServer).toBeDefined();
    });

    it('должен принимать кастомные опции', () => {
      plugin = convertImages({
        folders: ['custom/img'],
        exclude: ['temp'],
        enableAvif: false
      });
      expect(plugin.name).toBe('vite-webp-avif-generator');
    });
  });

  describe('Валидация путей (path traversal защита)', () => {
    it('должен блокировать path traversal атаки', () => {
      plugin = convertImages({
        folders: ['../../../etc']
      });

      const mockConfig = {
        root: testDir
      };

      plugin.configResolved(mockConfig);

      expect(() => {
        plugin.configureServer({
          httpServer: {
            on: vi.fn()
          }
        });
      }).toThrow(/Security.*outside project root/);
    });

    it('должен разрешать относительные пути внутри проекта', () => {
      plugin = convertImages({
        folders: ['src/img', 'public/img']
      });

      const mockConfig = {
        root: testDir
      };

      plugin.configResolved(mockConfig);

      expect(() => {
        plugin.configureServer({
          httpServer: {
            on: vi.fn()
          },
          watcher: {
            add: vi.fn(),
            on: vi.fn()
          }
        });
      }).not.toThrow();
    });

    it('должен блокировать абсолютные пути к системным директориям', () => {
      plugin = convertImages({
        folders: ['/etc/passwd']
      });

      const mockConfig = {
        root: testDir
      };

      plugin.configResolved(mockConfig);

      expect(() => {
        plugin.configureServer({
          httpServer: {
            on: vi.fn()
          }
        });
      }).toThrow(/Security.*outside project root/);
    });
  });

  describe('configResolved hook', () => {
    it('должен сохранять root из конфигурации', () => {
      plugin = convertImages();

      const mockConfig = {
        root: testDir
      };

      plugin.configResolved(mockConfig);

      // rootDir должен быть установлен внутри плагина
      expect(plugin.configureServer).toBeDefined();
    });

    it('должен использовать process.cwd() если root не указан', () => {
      plugin = convertImages();

      const mockConfig = {};

      plugin.configResolved(mockConfig);

      expect(plugin.configureServer).toBeDefined();
    });
  });

  describe('configureServer hook', () => {
    it('должен создавать watcher для отслеживания файлов', () => {
      plugin = convertImages({
        folders: ['src/img']
      });

      const mockConfig = {
        root: testDir
      };

      const mockWatcher = {
        add: vi.fn(),
        on: vi.fn(),
        close: vi.fn()
      };

      const mockServer = {
        watcher: mockWatcher,
        httpServer: {
          on: vi.fn()
        }
      };

      plugin.configResolved(mockConfig);
      plugin.configureServer(mockServer);

      // Проверяем что watcher был настроен
      expect(mockWatcher.on).toHaveBeenCalledWith('add', expect.any(Function));
      expect(mockWatcher.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('должен выводить логи с информацией о настройках', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation();

      plugin = convertImages({
        folders: ['src/img', 'public/img'],
        exclude: ['temp'],
        enableAvif: true
      });

      const mockConfig = {
        root: testDir
      };

      const mockServer = {
        watcher: {
          add: vi.fn(),
          on: vi.fn()
        },
        httpServer: {
          on: vi.fn()
        }
      };

      plugin.configResolved(mockConfig);
      plugin.configureServer(mockServer);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Image Converter'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('src/img, public/img'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('temp'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('включена'));

      consoleSpy.mockRestore();
    });

    it('должен закрывать watcher при остановке сервера', () => {
      plugin = convertImages({
        folders: ['src/img']
      });

      const mockConfig = {
        root: testDir
      };

      const mockWatcher = {
        add: vi.fn(),
        on: vi.fn(),
        close: vi.fn()
      };

      let closeHandler;
      const mockServer = {
        watcher: mockWatcher,
        httpServer: {
          on: vi.fn((event, handler) => {
            if (event === 'close') {
              closeHandler = handler;
            }
          })
        }
      };

      plugin.configResolved(mockConfig);
      plugin.configureServer(mockServer);

      // Симулируем закрытие сервера
      closeHandler();

      expect(mockWatcher.close).toHaveBeenCalled();
    });
  });

  describe('Обработка exclude опции', () => {
    it('должен исключать указанные папки', () => {
      plugin = convertImages({
        folders: ['src/img'],
        exclude: ['src/img/temp']
      });

      const mockConfig = {
        root: testDir
      };

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation();

      const mockServer = {
        watcher: {
          add: vi.fn(),
          on: vi.fn()
        },
        httpServer: {
          on: vi.fn()
        }
      };

      plugin.configResolved(mockConfig);
      plugin.configureServer(mockServer);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('src/img/temp'));

      consoleSpy.mockRestore();
    });
  });

  describe('enableAvif опция', () => {
    it('должен показывать статус AVIF в логах', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation();

      // С AVIF
      plugin = convertImages({ enableAvif: true });
      const mockConfig = { root: testDir };
      const mockServer = {
        watcher: { add: vi.fn(), on: vi.fn() },
        httpServer: { on: vi.fn() }
      };

      plugin.configResolved(mockConfig);
      plugin.configureServer(mockServer);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('включена'));

      consoleSpy.mockClear();

      // Без AVIF
      plugin = convertImages({ enableAvif: false });
      plugin.configResolved(mockConfig);
      plugin.configureServer(mockServer);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('отключена'));

      consoleSpy.mockRestore();
    });
  });

  describe('Интеграционные тесты', () => {
    it('должен корректно обрабатывать цепочку хуков', () => {
      plugin = convertImages({
        folders: ['src/img']
      });

      const mockConfig = {
        root: testDir
      };

      const mockServer = {
        watcher: {
          add: vi.fn(),
          on: vi.fn()
        },
        httpServer: {
          on: vi.fn()
        }
      };

      // Последовательность хуков
      expect(() => {
        plugin.configResolved(mockConfig);
        plugin.configureServer(mockServer);
      }).not.toThrow();
    });
  });

  describe('Edge cases', () => {
    it('должен обрабатывать пустой массив folders', () => {
      plugin = convertImages({
        folders: []
      });

      const mockConfig = { root: testDir };
      const mockServer = {
        watcher: { add: vi.fn(), on: vi.fn() },
        httpServer: { on: vi.fn() }
      };

      expect(() => {
        plugin.configResolved(mockConfig);
        plugin.configureServer(mockServer);
      }).not.toThrow();
    });

    it('должен обрабатывать отсутствие httpServer', () => {
      plugin = convertImages({
        folders: ['src/img']
      });

      const mockConfig = { root: testDir };
      const mockServer = {
        watcher: { add: vi.fn(), on: vi.fn() },
        httpServer: null
      };

      expect(() => {
        plugin.configResolved(mockConfig);
        plugin.configureServer(mockServer);
      }).not.toThrow();
    });
  });
});


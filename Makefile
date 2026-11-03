SHELL_UUID := homescreen@engida32.github.io
PACK := dist/$(SHELL_UUID).shell-extension.zip

.PHONY: schemas pack install uninstall test check clean

schemas:
	glib-compile-schemas extension/schemas

pack: schemas
	mkdir -p dist
	gnome-extensions pack --force \
		--extra-source=src \
		--schema=schemas/org.gnome.shell.extensions.homescreen.gschema.xml \
		--out-dir=dist extension

install: pack
	gnome-extensions install --force $(PACK)
	gnome-extensions enable $(SHELL_UUID)

uninstall:
	-gnome-extensions disable $(SHELL_UUID)
	gnome-extensions uninstall $(SHELL_UUID)

test: schemas
	python3 scripts/validate-metadata.py
	@for file in tests/*.test.js; do \
		[ -e "$$file" ] || continue; \
		GSETTINGS_SCHEMA_DIR="$(CURDIR)/extension/schemas" \
		GSETTINGS_BACKEND=memory \
		gjs -m "$$file"; \
	done
	@for file in extension/extension.js extension/prefs.js $$(find extension/src -name '*.js' -type f); do \
		[ -e "$$file" ] || continue; \
		node --input-type=module --check < "$$file"; \
	done

check: pack test
	bash tests/headless-install-probe.sh

clean:
	rm -rf dist extension/schemas/gschemas.compiled

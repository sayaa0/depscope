import { removed, stable as renamedStable } from 'fixture-package';
import * as fixture from 'fixture-package';

removed();
renamedStable();
fixture.parse('value');

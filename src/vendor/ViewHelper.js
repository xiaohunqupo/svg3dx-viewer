import {
	CylinderGeometry,
	CanvasTexture,
	Color,
	Matrix4,
	Mesh,
	MeshBasicMaterial,
	Object3D,
	OrthographicCamera,
	Quaternion,
	Raycaster,
	Sprite,
	SpriteMaterial,
	SRGBColorSpace,
	Vector2,
	Vector3,
	Vector4
} from 'three';

class ViewHelper extends Object3D {

	constructor( camera, domElement ) {

		super();

		this.isViewHelper = true;

		this.animating = false;
		this.center = new Vector3();

		const color1 = new Color( '#ff4466' );
		const color2 = new Color( '#88ff44' );
		const color3 = new Color( '#4488ff' );
		const color4 = new Color( '#000000' );

		const options = {};

		const interactiveObjects = [];
		const raycaster = new Raycaster();
		const mouse = new Vector2();
		const dummy = new Object3D();
		// svg3dx is Z-up; stock ViewHelper assumes Y-up lookAt / Euler homes.
		const worldUp = new Vector3( 0, 0, 1 );
		const altUp = new Vector3( 0, 1, 0 );
		const lookDir = new Vector3();
		dummy.up.copy( worldUp );

		const orthoCamera = new OrthographicCamera( - 2, 2, 2, - 2, 0, 4 );
		orthoCamera.position.set( 0, 0, 2 );

		const geometry = new CylinderGeometry( 0.04, 0.04, 0.8, 5 ).rotateZ( - Math.PI / 2 ).translate( 0.4, 0, 0 );

		const xAxis = new Mesh( geometry, getAxisMaterial( color1 ) );
		const yAxis = new Mesh( geometry, getAxisMaterial( color2 ) );
		const zAxis = new Mesh( geometry, getAxisMaterial( color3 ) );

		yAxis.rotation.z = Math.PI / 2;
		zAxis.rotation.y = - Math.PI / 2;

		this.add( xAxis );
		this.add( zAxis );
		this.add( yAxis );

		const spriteMaterial1 = getSpriteMaterial( color1 );
		const spriteMaterial2 = getSpriteMaterial( color2 );
		const spriteMaterial3 = getSpriteMaterial( color3 );

		const posXAxisHelper = new Sprite( spriteMaterial1 );
		const posYAxisHelper = new Sprite( spriteMaterial2 );
		const posZAxisHelper = new Sprite( spriteMaterial3 );
		const negXAxisHelper = new Sprite();
		const negYAxisHelper = new Sprite();
		const negZAxisHelper = new Sprite();

		posXAxisHelper.position.x = 1;
		posYAxisHelper.position.y = 1;
		posZAxisHelper.position.z = 1;
		negXAxisHelper.position.x = - 1;
		negYAxisHelper.position.y = - 1;
		negZAxisHelper.position.z = - 1;

		// Stock three.js uses black @ 0.2 — invisible on dark scene backgrounds.
		applyNegativeAxisMaterial( color4, 0.2 );

		posXAxisHelper.userData.type = 'posX';
		posYAxisHelper.userData.type = 'posY';
		posZAxisHelper.userData.type = 'posZ';
		negXAxisHelper.userData.type = 'negX';
		negYAxisHelper.userData.type = 'negY';
		negZAxisHelper.userData.type = 'negZ';

		this.add( posXAxisHelper );
		this.add( posYAxisHelper );
		this.add( posZAxisHelper );
		this.add( negXAxisHelper );
		this.add( negYAxisHelper );
		this.add( negZAxisHelper );

		interactiveObjects.push( posXAxisHelper );
		interactiveObjects.push( posYAxisHelper );
		interactiveObjects.push( posZAxisHelper );
		interactiveObjects.push( negXAxisHelper );
		interactiveObjects.push( negYAxisHelper );
		interactiveObjects.push( negZAxisHelper );

		const point = new Vector3();
		const dim = 128;
		const turnRate = 2 * Math.PI; // turn rate in angles per second
		// angleTo() of near-equal / non-unit quats often returns ~1e-8, never === 0.
		const angleEps = 1e-5;
		let animElapsed = 0;
		const animMaxSeconds = 2;

		this.render = function ( renderer ) {

			this.quaternion.copy( camera.quaternion ).invert();
			this.updateMatrixWorld();

			point.set( 0, 0, 1 );
			point.applyQuaternion( camera.quaternion );

			//

			// Top-right corner (WebGL y grows upward from the canvas bottom).
			const x = domElement.offsetWidth - dim;
			const y = domElement.offsetHeight - dim;

			renderer.clearDepth();

			renderer.getViewport( viewport );
			renderer.setViewport( x, y, dim, dim );

			renderer.render( this, orthoCamera );

			renderer.setViewport( viewport.x, viewport.y, viewport.z, viewport.w );

		};

		const targetPosition = new Vector3();
		const targetQuaternion = new Quaternion();

		const q1 = new Quaternion();
		const q2 = new Quaternion();
		const viewport = new Vector4();
		let radius = 0;

		this.handleClick = function ( event ) {

			const rect = domElement.getBoundingClientRect();
			// Must match render(): top-right CSS panel (stock three.js uses bottom-right).
			const offsetX = rect.left + ( domElement.offsetWidth - dim );
			const offsetY = rect.top;
			mouse.x = ( ( event.clientX - offsetX ) / dim ) * 2 - 1;
			mouse.y = - ( ( event.clientY - offsetY ) / dim ) * 2 + 1;

			raycaster.setFromCamera( mouse, orthoCamera );

			const intersects = raycaster.intersectObjects( interactiveObjects );

			if ( intersects.length > 0 ) {

				const intersection = intersects[ 0 ];
				const object = intersection.object;

				// Allow interrupting an in-flight home so rapid clicks cannot wedge
				// the viewer with animating===true forever.
				prepareAnimationData( object, this.center );
				animElapsed = 0;
				this.animating = true;

				return true;

			} else {

				return false;

			}

		};

		this.setLabels = function ( labelX, labelY, labelZ ) {

			options.labelX = labelX;
			options.labelY = labelY;
			options.labelZ = labelZ;

			updateLabels();

		};

		this.setLabelStyle = function ( font, color, radius ) {

			options.font = font;
			options.color = color;
			options.radius = radius;

			updateLabels();

		};

		/**
		 * Pick −X/−Y/−Z disc color from scene background luminance so the
		 * gizmo stays readable in both light and dark themes.
		 */
		this.adaptToBackground = function ( background ) {

			const bg = background.isColor ? background : new Color( background );
			// Relative luminance (sRGB linearized channels already in Color).
			const lum = 0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b;
			if ( lum < 0.45 ) {

				applyNegativeAxisMaterial( new Color( '#ffffff' ), 0.35 );

			} else {

				applyNegativeAxisMaterial( new Color( '#000000' ), 0.2 );

			}

		};

		this.update = function ( delta ) {

			const dt = Math.max( delta, 0 );
			animElapsed += dt;
			const step = dt * turnRate;

			// animate position by doing a slerp and then scaling the position on the unit sphere
			// (0,0,1) is dummy local +Z = opposite lookAt forward; valid for any up.

			q1.rotateTowards( q2, step );
			camera.position.set( 0, 0, 1 ).applyQuaternion( q1 ).multiplyScalar( radius ).add( this.center );

			// animate orientation

			camera.quaternion.rotateTowards( targetQuaternion, step );
			camera.up.copy( worldUp );

			if ( q1.angleTo( q2 ) <= angleEps || animElapsed >= animMaxSeconds ) {

				q1.copy( q2 );
				camera.position.set( 0, 0, 1 ).applyQuaternion( q2 ).multiplyScalar( radius ).add( this.center );
				camera.quaternion.copy( targetQuaternion );
				camera.up.copy( worldUp );
				animElapsed = 0;
				this.animating = false;

			}

		};

		this.dispose = function () {

			geometry.dispose();

			xAxis.material.dispose();
			yAxis.material.dispose();
			zAxis.material.dispose();

			posXAxisHelper.material.map.dispose();
			posYAxisHelper.material.map.dispose();
			posZAxisHelper.material.map.dispose();
			negXAxisHelper.material.map.dispose();

			posXAxisHelper.material.dispose();
			posYAxisHelper.material.dispose();
			posZAxisHelper.material.dispose();
			negXAxisHelper.material.dispose();

		};

		function upForViewDir( dir ) {

			// lookAt is singular when view ∥ world up; use +Y as north then.
			return Math.abs( dir.dot( worldUp ) ) > 0.99 ? altUp : worldUp;

		}

		function orientDummyToward( point ) {

			lookDir.subVectors( point, dummy.position ).normalize();
			dummy.up.copy( upForViewDir( lookDir ) );
			dummy.lookAt( point );

		}

		const _lookMatrix = new Matrix4();

		function cameraQuatLookingAt( eyePos, focusPoint ) {

			// Camera looks down -Z; Object3D.lookAt points +Z, so use Matrix4.lookAt.
			lookDir.subVectors( focusPoint, eyePos ).normalize();
			_lookMatrix.lookAt( eyePos, focusPoint, upForViewDir( lookDir ) );
			targetQuaternion.setFromRotationMatrix( _lookMatrix );

		}

		function prepareAnimationData( object, focusPoint ) {

			switch ( object.userData.type ) {

				case 'posX':
					targetPosition.set( 1, 0, 0 );
					break;

				case 'posY':
					targetPosition.set( 0, 1, 0 );
					break;

				case 'posZ':
					targetPosition.set( 0, 0, 1 );
					break;

				case 'negX':
					targetPosition.set( - 1, 0, 0 );
					break;

				case 'negY':
					targetPosition.set( 0, - 1, 0 );
					break;

				case 'negZ':
					targetPosition.set( 0, 0, - 1 );
					break;

				default:
					console.error( 'ViewHelper: Invalid axis.' );
					return;

			}

			radius = camera.position.distanceTo( focusPoint );
			targetPosition.multiplyScalar( radius ).add( focusPoint );

			dummy.position.copy( focusPoint );
			orientDummyToward( camera.position );
			q1.copy( dummy.quaternion ).normalize();

			orientDummyToward( targetPosition );
			q2.copy( dummy.quaternion ).normalize();

			cameraQuatLookingAt( targetPosition, focusPoint );
			targetQuaternion.normalize();

		}

		function getAxisMaterial( color ) {

			return new MeshBasicMaterial( { color: color, toneMapped: false } );

		}

		function applyNegativeAxisMaterial( color, opacity ) {

			const prev = negXAxisHelper.material;
			if ( prev && prev !== posXAxisHelper.material ) {

				prev.map && prev.map.dispose();
				prev.dispose();

			}

			const mat = getSpriteMaterial( color );
			mat.opacity = opacity;
			mat.transparent = true;

			negXAxisHelper.material = mat;
			negYAxisHelper.material = mat;
			negZAxisHelper.material = mat;

		}

		function getSpriteMaterial( color, text ) {

			const { font = '24px Arial', color: labelColor = '#000000', radius = 14 } = options;

			const canvas = document.createElement( 'canvas' );
			canvas.width = 64;
			canvas.height = 64;

			const context = canvas.getContext( '2d' );
			context.beginPath();
			context.arc( 32, 32, radius, 0, 2 * Math.PI );
			context.closePath();
			context.fillStyle = color.getStyle();
			context.fill();

			if ( text ) {

				context.font = font;
				context.textAlign = 'center';
				context.fillStyle = labelColor;
				context.fillText( text, 32, 41 );

			}

			const texture = new CanvasTexture( canvas );
			texture.colorSpace = SRGBColorSpace;

			return new SpriteMaterial( { map: texture, toneMapped: false } );

		}

		function updateLabels() {

			posXAxisHelper.material.map.dispose();
			posYAxisHelper.material.map.dispose();
			posZAxisHelper.material.map.dispose();

			posXAxisHelper.material.dispose();
			posYAxisHelper.material.dispose();
			posZAxisHelper.material.dispose();

			posXAxisHelper.material = getSpriteMaterial( color1, options.labelX );
			posYAxisHelper.material = getSpriteMaterial( color2, options.labelY );
			posZAxisHelper.material = getSpriteMaterial( color3, options.labelZ );

		}

	}

}

export { ViewHelper };
